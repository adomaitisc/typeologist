#!/usr/bin/env node

import fetch from "node-fetch";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import mri from "mri";
import * as prompts from "@clack/prompts";
import colors from "picocolors";

const { black, bgBlue, blue, cyan, green, magenta, red, yellow } = colors;

const argv = mri(process.argv.slice(2), {
  alias: {
    h: "help",
    u: "url",
    f: "formats",
    c: "concurrency",
    b: "blind",
    o: "output",
  },
  boolean: ["help", "blind"],
  string: ["url", "formats", "output"],
  default: { concurrency: 30 },
});

const CONCURRENCY_LIMIT = Math.max(1, parseInt(argv.concurrency) || 30);

// Get output directory (defaults to user's downloads folder)
function getOutputDir() {
  if (argv.output) {
    return argv.output;
  }

  // Get user's downloads folder
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    return "fonts"; // Fallback to current directory
  }

  // Platform-specific downloads folder
  if (process.platform === "win32") {
    return path.join(homeDir, "Downloads", "typeologist");
  } else {
    return path.join(homeDir, "Downloads", "typeologist");
  }
}

const OUTPUT_DIR = getOutputDir();

const helpMessage = `\
Extract font files from websites.
With no arguments, start the CLI in interactive mode.

Options:
  -u, --url URL              target website URL
  -f, --formats FORMATS      comma-separated font formats (all, woff2, woff, ttf, otf, eot)
  -c, --concurrency NUM      concurrent requests (default 30)
  -b, --blind                download all fonts automatically (no selection)
  -o, --output PATH          output directory (default: ~/Downloads/typeologist)
  -h, --help                 display this help message

Examples:
  node index.js -u https://example.com -f woff2,woff
  node index.js -u https://example.com -f all
  node index.js -u https://example.com -f ttf -c 50 -b`;

const FONT_FORMATS = [
  {
    name: "all",
    display: "All Formats",
    color: blue,
    extensions: ["woff2", "woff", "ttf", "otf", "eot"],
  },
  {
    name: "woff2",
    display: "Web Open Font Format 2.0",
    color: yellow,
    extensions: ["woff2"],
  },
  {
    name: "woff",
    display: "Web Open Font Format",
    color: green,
    extensions: ["woff"],
  },
  {
    name: "ttf",
    display: "TrueType Font",
    color: cyan,
    extensions: ["ttf"],
  },
  {
    name: "otf",
    display: "OpenType Font",
    color: magenta,
    extensions: ["otf"],
  },
  {
    name: "eot",
    display: "Embedded OpenType",
    color: red,
    extensions: ["eot"],
  },
];

async function extractUrls(url) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;
    const urls = new Set();

    const allElements = document.querySelectorAll("*");
    allElements.forEach((element) => {
      const attributes = element.attributes;
      for (let i = 0; i < attributes.length; i++) {
        const attr = attributes[i];
        const value = attr.value;

        if (value && value.trim()) {
          const foundUrls = extractUrlsFromText(value.trim());
          foundUrls.forEach((url) => urls.add(url));
        }
      }
    });

    const textContent = document.body ? document.body.textContent : "";
    const textUrls = extractUrlsFromText(textContent);
    textUrls.forEach((url) => urls.add(url));

    const scripts = document.querySelectorAll(
      'script[type="application/ld+json"]'
    );
    scripts.forEach((script) => {
      try {
        const jsonData = JSON.parse(script.textContent);
        extractUrlsFromJson(jsonData, urls);
      } catch (e) {
        // Ignore JSON parsing errors
      }
    });

    const absoluteUrls = new Set();
    urls.forEach((url) => {
      try {
        const absoluteUrl = new URL(url, response.url).href;
        absoluteUrls.add(absoluteUrl);
      } catch (e) {
        absoluteUrls.add(url);
      }
    });

    return Array.from(absoluteUrls).sort();
  } catch (error) {
    prompts.log.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

function extractUrlsFromText(text) {
  const urls = new Set();

  const urlPatterns = [
    /https?:\/\/[^\s"'<>{}|\\^`\[\]]+/gi,
    /\/\/[^\s"'<>{}|\\^`\[\]]+/gi,
    /[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}(\/[^\s"'<>{}|\\^`\[\]]*)?/gi,
    /\/[^\s"'<>{}|\\^`\[\]]+/gi,
  ];

  urlPatterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        let cleanUrl = match.trim();
        cleanUrl = cleanUrl.replace(/[.,;!?]+$/, "");

        if (cleanUrl.length > 2 && !/^[.,;!?\/]+$/.test(cleanUrl)) {
          urls.add(cleanUrl);
        }
      });
    }
  });

  return urls;
}

function extractUrlsFromJson(obj, urls) {
  if (typeof obj === "string") {
    const foundUrls = extractUrlsFromText(obj);
    foundUrls.forEach((url) => urls.add(url));
  } else if (typeof obj === "object" && obj !== null) {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        extractUrlsFromJson(obj[key], urls);
      }
    }
  }
}

function filterUrlsByExtension(urls, extensions) {
  return urls.filter((url) => {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastSegment = pathname.split("/").pop();

      return extensions.some((ext) => {
        const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
        return lastSegment.toLowerCase().endsWith(normalizedExt.toLowerCase());
      });
    } catch (e) {
      return false;
    }
  });
}

async function testUrl(url) {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch (error) {
    return false;
  }
}

async function testUrls(urls) {
  const sweepSpinner = prompts.spinner();
  sweepSpinner.start(`Sweeping through ${urls.length} possible fonts...`);

  const results = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
    const batch = urls.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (url) => ({
        url,
        accessible: await testUrl(url),
      }))
    );
    results.push(...batchResults);
  }

  const accessibleCount = results.filter((result) => result.accessible).length;
  sweepSpinner.stop(
    `There ${
      accessibleCount == 1
        ? "is 1 downloadable font"
        : `are ${accessibleCount} downloadable fonts`
    }.`
  );

  return results
    .filter((result) => result.accessible)
    .map((result) => result.url);
}

async function downloadFontFiles(urls) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < urls.length; i += CONCURRENCY_LIMIT) {
    const batch = urls.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        try {
          const urlObj = new URL(url);
          const pathname = urlObj.pathname;
          const filename = pathname.split("/").pop();

          if (!filename) {
            return {
              success: false,
              filename: "unknown",
              error: "No filename found",
            };
          }

          const response = await fetch(url);

          if (!response.ok) {
            return {
              success: false,
              filename,
              error: `HTTP ${response.status}`,
            };
          }

          const buffer = await response.arrayBuffer();
          const filePath = path.join(OUTPUT_DIR, filename);

          fs.writeFileSync(filePath, Buffer.from(buffer));
          return { success: true, filename };
        } catch (error) {
          return { success: false, filename: "unknown", error: error.message };
        }
      })
    );
    results.push(...batchResults);
  }

  const successful = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  if (failed > 0) {
    prompts.note(
      results
        .filter((r) => !r.success)
        .map((result) => red(`✗ ${result.filename} - ${result.error}`))
        .join("\n"),
      red(`Failed to download ${failed} files:`)
    );
  }

  if (successful > 0) {
    prompts.note(
      results
        .filter((r) => r.success)
        .map((result) => green(`✓ ${result.filename}`))
        .join("\n"),
      green(
        `Downloaded ${successful} font${
          successful === 1 ? "" : "s"
        } to ${OUTPUT_DIR}`
      )
    );
  }

  if (successful === 0 && failed === 0) {
    prompts.log.error("No font files found. Exiting...");
    process.exit(0);
  }
}

async function init() {
  const argUrl = argv.url;
  const argFormats = argv.formats;

  if (argv.help) {
    console.log(helpMessage);
    return;
  }

  const cancel = () => prompts.cancel("Operation cancelled");

  prompts.intro(bgBlue(black(" typeologist ")));

  let websiteUrl = argUrl;
  if (!websiteUrl) {
    const urlResult = await prompts.text({
      message: "Enter website URL:",
      placeholder: "https://example.com",
      validate: (value) => {
        if (!value) return "URL is required";
        try {
          new URL(value);
          return undefined;
        } catch (e) {
          return "Invalid URL format";
        }
      },
    });
    if (prompts.isCancel(urlResult)) return cancel();
    websiteUrl = urlResult;
  }

  let selectedFormats = [];

  if (argFormats) {
    // Parse comma-separated formats from command line
    const formatNames = argFormats
      .split(",")
      .map((f) => f.trim().toLowerCase());

    // Validate formats
    const validFormats = FONT_FORMATS.map((f) => f.name);
    const invalidFormats = formatNames.filter((f) => !validFormats.includes(f));

    if (invalidFormats.length > 0) {
      prompts.log.error(`Invalid format(s): ${invalidFormats.join(", ")}`);
      prompts.log.error(`Valid formats: ${validFormats.join(", ")}`);
      process.exit(1);
    }

    selectedFormats = formatNames;
  } else {
    // Interactive format selection
    const itemsPerPage = 15;
    let currentPage = 0;
    const totalPages = Math.ceil(FONT_FORMATS.length / itemsPerPage);

    while (currentPage < totalPages) {
      const startIndex = currentPage * itemsPerPage;
      const endIndex = startIndex + itemsPerPage;
      const pageFormats = FONT_FORMATS.slice(startIndex, endIndex);

      const pageMessage =
        totalPages > 1
          ? `Select font formats (page ${currentPage + 1} of ${totalPages}):`
          : "Select font formats:";

      const formatResult = await prompts.multiselect({
        message: pageMessage,
        hint:
          totalPages > 1
            ? `Showing ${pageFormats.length} of ${FONT_FORMATS.length} formats`
            : undefined,
        options: pageFormats.map((format) => {
          const formatColor = format.color;
          return {
            label: formatColor(
              `${format.display || format.name} (${format.extensions.join(
                ", "
              )})`
            ),
            value: format.name,
          };
        }),
      });

      if (prompts.isCancel(formatResult)) return cancel();

      selectedFormats.push(...formatResult);

      if (currentPage < totalPages - 1) {
        const continueResult = await prompts.select({
          message: "Continue to next page?",
          options: [
            { label: "Yes, show next page", value: "continue" },
            { label: "No, finish selection", value: "finish" },
          ],
        });

        if (prompts.isCancel(continueResult)) return cancel();

        if (continueResult === "finish") {
          break;
        }
      }

      currentPage++;
    }
  }

  if (selectedFormats.length === 0) {
    prompts.log.error("No formats selected. Exiting...");
    process.exit(0);
  }

  const extensions = [];
  selectedFormats.forEach((formatName) => {
    const selectedFormat = FONT_FORMATS.find((f) => f.name === formatName);
    if (selectedFormat) {
      extensions.push(...selectedFormat.extensions);
    }
  });

  const allUrls = await extractUrls(websiteUrl);

  const fontUrls = filterUrlsByExtension(allUrls, extensions);
  if (fontUrls.length === 0) {
    prompts.log.error("No font files found. Exiting...");
    process.exit(0);
  }

  const accessibleUrls = await testUrls(fontUrls);
  if (accessibleUrls.length === 0) {
    prompts.log.error("No accessible font files found. Exiting...");
    process.exit(0);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const fontItems = accessibleUrls
    .map((url) => {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const filename = pathname.split("/").pop();
      if (!filename) return null;
      const extension = filename.split(".").pop()?.toLowerCase();
      const colorMap = {
        woff2: yellow,
        woff: green,
        ttf: cyan,
        otf: magenta,
        eot: red,
      };
      const color = colorMap[extension] || blue;
      return {
        label: color(filename),
        value: url,
      };
    })
    .filter(Boolean);

  let selectedFonts;

  if (argv.blind) {
    // Blind mode: download all fonts automatically
    selectedFonts = accessibleUrls;
    prompts.log.step(
      `Blind mode enabled. Downloading all ${accessibleUrls.length} fonts automatically...`
    );
  } else {
    // Interactive mode: let user select fonts
    selectedFonts = await prompts.multiselect({
      message: "Select fonts to download:",
      options: fontItems,
      maxItems: 10,
    });

    if (prompts.isCancel(selectedFonts)) return cancel();

    if (selectedFonts.length === 0) {
      prompts.log.error("No fonts selected. Exiting...");
      process.exit(0);
    }
  }

  await downloadFontFiles(selectedFonts);

  prompts.outro(
    bgBlue(black(` Information wants to be free - Stewart Brand `))
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  init().catch((e) => {
    console.error(e);
  });
}
