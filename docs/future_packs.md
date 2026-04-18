# Future Category Packs

This file tracks **planned category packs** (domain workflows), their intended features, and status. When you add or ship a pack in the product, update this document and move the pack between **Planned**, **In progress**, and **Completed**.

**Status labels:** `planned` · `in progress` · `completed`

---

## Tax Management (COMPLETED)

**Features:**

- Document organization  
- PDF comparison (multi-year, 2–5 documents)  
- Field extraction and display labels  
- Anomaly detection (configurable % threshold)  
- Trend analysis  
- User correction + learning (feedback store)  
- Client-level grouping in UI (by client / tax year)  
- Export (JSON / CSV) and lightweight session restore (browser localStorage)  

---

## Fitness Tracking — **completed** (v1 pack + UI)

**Features (shipped in repo):**

- Pack registry + `packs/fitness` triad  
- Domain `fitness` (timeline tagging, rename, folder hints, `fitness_image_comparison`)  
- Filesystem scan of `Clients/*/Timeline/*`  
- Client selector + stage timeline + pairwise image compare  
- Label corrections via feedback store (`fitness_label_correction`)  

**Roadmap / later:**

- Richer client profiles and metrics dashboards  
- Transformation PDF reports  

---

## General Contractor (PLANNED)

**Features:**

- Project (house) tracking  
- Room-based organization (kitchen, bedroom, etc.)  
- Progress timeline (before → weekly → complete)  
- Cost tracking (initial vs actual)  
- Budget vs overrun analysis  
- Transformation records (visual history)  
- Client presentation reports  

---

## Future Ideas

- Legal case tracking  
- Medical record organization  
- Business finance tracking  

---

## Maintenance rule

When a **new pack** is created or shipped:

1. Add or update its section in this file.  
2. Set **status** to one of: `planned`, `in progress`, `completed`.  
3. Keep the feature list aligned with what the pack actually delivers (no aspirational bullets once shipped).  
