# Security And Privacy

Please report security-sensitive issues privately if possible. If you cannot, open a GitHub issue with the minimum detail needed to describe the problem and avoid posting private data.

## Data Handling

The app is designed for local use. Generated PowerPoints, review history, cache files, imported PDFs, extracted images, and SQLite state should not be committed.

The SQLite database may include local file paths, reviewed case titles, random history, image decisions, backend job timing/details, and generated PowerPoint metadata. Treat it as private local state.

Do not share:

- private patient data
- private study PDFs
- generated PowerPoints containing material you cannot redistribute
- extracted Radiopaedia or book images outside their license/terms
- local paths that reveal sensitive information

## Medical Disclaimer

This project is for education and presentation preparation. It is not a medical device and should not be used for clinical diagnosis or patient care decisions.
