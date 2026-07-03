# PubMaxing

PubMaxing is a London pub discovery and crawl-design app. It uses pint prices, venue location, amenities, and route preferences to help people choose a pub crawl.

## Dataset

The app uses the extracted dataset.

- Source CSV for app use: `data/pint_prices_app_dataset.csv`
- Public JSON loaded by the website: `public/data/pint_prices_app_dataset.json`
- Builder script: `scripts/build_app_dataset.py`
- JSON export script: `scripts/export_app_dataset_json.py`

The current website does not insert the dataset into a database yet. It loads the exported JSON file in the browser and renders map markers, filters, venue detail, and crawl suggestions from that data.

## Run Locally

```bash
npm install
npm run export:data
npm run dev
```

Then open `http://127.0.0.1:3000`.

## Verification

```bash
npm run build
python3 scripts/build_app_dataset.py
python3 scripts/export_app_dataset_json.py
```

## Product Notes

- `docs/PRODUCT_PLAN.md` contains the current MVP plan.
- `CONTEXT.md` contains the domain language.
- `docs/adr/0001-multi-factor-crawl-routes.md` records the decision to rank routes with multiple signals, not only cheapest pint price.
