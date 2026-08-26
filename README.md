# ProduceScan

A single-page web app that scans barcodes and PLU stickers on fruits &amp;
vegetables (like apples) and shows details about them - built with Canadian
grocery shopping in mind.

## What it does

- **Camera scanning**: uses your device camera (via
  [html5-qrcode](https://github.com/mebjas/html5-qrcode)) to read both
  1D barcodes (UPC-A/EAN-13, used on packaged produce) and PLU sticker codes.
- **PLU lookup**: loose produce (like a Gala apple) is usually identified by a
  4-5 digit PLU sticker rather than a scannable barcode, so there's also a
  manual entry box. `plu-data.js` has a small, hand-checked reference table
  covering common Canadian grocery items (many apple varieties, plus common
  fruits & veg), and the app explains what the code format itself means:
  - **4 digits** → conventionally grown
  - **5 digits starting with 9** → certified organic
  - **5 digits starting with 8** → legacy "bioengineered" flag (optional
    since ~2015, so its absence doesn't mean non-GMO)
- **Barcode lookup**: for packaged items (e.g. a bag of apples with a real
  UPC/EAN barcode), the app queries the free, crowd-sourced
  [Open Food Facts](https://world.openfoodfacts.org/) API for product name,
  brand, quantity, ingredients, nutrition (kcal/sugar/fibre per 100g), and any
  notable certifications on file (organic, fair trade, Non-GMO Project
  Verified, etc.).
- **Pesticide-residue context**: PLU entries can be tagged with EWG's 2026
  "Dirty Dozen" / "Clean Fifteen" Shopper's Guide to Pesticides - a published,
  commodity-level ranking of which conventionally-grown produce types most/
  least often test positive for residue in US sampling. Shown as a reference
  note, not a lab result for the specific item scanned.
- **Search by name**: type a produce name (e.g. "honeycrisp") to find its PLU
  code without scanning.
- **Expiry checking**: after scanning a packaged product, enter the expiry date printed on that package. The app immediately reports whether it is good, expiring soon, or expired, and remembers the date on that device. Standard UPC/EAN barcodes identify products but do not encode package-specific expiry dates.
- **Scan history**: recent lookups are kept in `localStorage` for quick
  re-viewing.

## Running it

It's a static site - just serve the folder and open it in a browser:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Camera access requires HTTPS (or
`localhost`), so for real device testing, deploy it (e.g. GitHub Pages) or
use a tool like `ngrok`.

## Accuracy notes

- The PLU reference data in `plu-data.js` is a curated **sample**, not the
  full official IFPS PLU list (1000+ codes, and it changes over time).
  Codes can also vary by region, size grade, or grower. Treat matches as a
  helpful reference, not a guarantee.
- In Canada, produce labelled "organic" must be certified under the Canada
  Organic Regime (CFIA) - look for the Canada Organic logo to confirm.

## Files

- `index.html` - markup, styles, and the camera reader container
- `app.js` - scanning, code classification, lookups, and rendering
- `plu-data.js` - the local PLU reference table
# produce-barcode-spanner
