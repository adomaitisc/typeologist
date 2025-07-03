# Typeologist

Extract font files from websites via the command line.

## Quick Start

1. Clone the repo and install dependencies:

```bash
git clone <repository-url>
cd typeologist
npm install
```

2. Run the CLI:

```bash
node index.js -u https://example.com -f all
```

See `node index.js --help` for all options.

## Addendum

**Note:** The core library used for the multiselect feature currently does not support scrolling and full views. This may affect usability when dealing with large lists. We are tracking this limitation and will update the tool when upstream support is available.
