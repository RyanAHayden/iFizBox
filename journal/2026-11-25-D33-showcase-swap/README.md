# D33 Swap the README showcase for the F441 cut

- Source: the approved F441 4:5 MP4 (`ref/f441/showcase-4x5.mp4`, 10612340 bytes).
- `docs/img/showcase.webp` regenerated with ffmpeg `fps=10,scale=400:-2`, libwebp_anim `-q:v 28 -compression_level 6 -loop 0`: 995224 bytes (under 1 MB).
- Release v1.0.0 asset `showcase.mp4` replaced (RyanAHayden token, `--clobber`). A first upload kept the file's own name and made a stray `showcase-4x5.mp4` asset; deleted it.
- README alt text still fits the video; unchanged.

**Not verified**: a plain HEAD request on the MP4 URL still showed the old size for a while (GitHub CDN cache); a GET returned 10612340 bytes and the API lists that size. I did not watch the webp itself.
