# Pack: ecommerce

This pack was created or extended by `dev/generate_pack_system.mjs`. The UI (Capability, Tunnel, ProcessIntel) reads **reference.json**, **structure.json**, and **reference_assets/** at runtime — no manual UI wiring.

## Categories (11)

- `accessories` — Accessories
- `bags` — Bags
- `bottoms` — Bottoms
- `documents` — Documents
- `dresses` — Dresses
- `outerwear` — Outerwear
- `packaging` — Packaging
- `product_flat` — Product Flat
- `product_on_model` — Product On Model
- `shoes` — Shoes
- `tops` — Tops

## Groups (UX)

- **Catalog & Products** (`product`): accessories, bags, bottoms, dresses, outerwear, packaging, product_flat, product_on_model, shoes, tops
- **Documents** (`documents`): documents

## Process intelligence

File: `reference_assets/processes.json` — per-category **priority**, **review_required**, **purpose**, and **actions** for workflow-aware UI (not used for classification).

- `accessories`: priority **low**, review **no**
- `bags`: priority **medium**, review **yes**
- `bottoms`: priority **medium**, review **no**
- `documents`: priority **high**, review **yes**
- `dresses`: priority **medium**, review **no**
- `outerwear`: priority **medium**, review **no**
- `packaging`: priority **medium**, review **no**
- `product_flat`: priority **low**, review **no**
- `product_on_model`: priority **medium**, review **no**
- `shoes`: priority **high**, review **yes**
- `tops`: priority **medium**, review **no**

## Reference assets

- `reference_assets/images/<category>/` — synthetic PNGs (CLIP)
- `reference_assets/documents/<category>/` — mock JSON/txt
- `reference_assets/patterns.json` — metadata for suggestions / UX

## Load pack

```bash
node -e "import('./packs/loadIndustryPack.js').then(m => m.loadIndustryPack('ecommerce'))"
```

Or use the in-app industry selector.
