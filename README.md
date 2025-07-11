# Typeologist

Extract font files from websites via the command line.

## Quick Start

1. Clone the repo and install dependencies:

```bash
git clone https://github.com/adomaitisc/typeologist.git
cd typeologist
npm install
npm link
```

2. Run the CLI:

```bash
typeologist -u https://example.com -f all
```

See `typeologist --help` for all options.

## Addendum

**Note:** The core library used for the multiselect feature currently does not support scrolling and full views. This may affect usability when dealing with large lists. I am tracking this limitation and will update the tool when upstream support is available.
