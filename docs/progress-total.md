# Model loading progress

Alpha 2 reads the aggregate `progress_total` event from Transformers.js 4.x for end-to-end model download progress. Per-file `progress` events are shown only as current-file detail and are not used to calculate the overall percentage.
