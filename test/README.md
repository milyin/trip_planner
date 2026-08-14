# Local OCR fixtures

`npm run test:ocr` recognizes every image in `test/assets` in a real browser and
checks the structured trip produced by Scribe.js and the built-in parser.

To add a case, place the image in `test/assets` and add a sidecar named
`<image-name>.expected.json`. The sidecar selects the OCR languages, fixes the
reference time used for year inference, lists fields that must match under
`expected`, and can list fields that must remain missing under `absent`.
Optional `lookups` mock Nominatim responses and `dialogExpected` verifies fields
after the dialog enriches recognized station or airport identifiers.

The test deliberately fails when an image has no expectation sidecar.
