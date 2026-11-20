# v3 follow-ups

Items from Phase 6 that are not blockers (no security hole, no data loss, no broken sign-in, save, publish, or upload). Each waits for Phase 7. One line each.

1. The save bar's preview watch does not start again after a media upload or a new sign-in; the status panel shows the newest state.
2. Cancel pressed after a Blob upload's last bytes does not ask the server, and a file Blob writes after the server answered that nothing was there stays unconfirmed; both are listed under "Not used anywhere", to delete.
3. A deleted Blob file leaves a 23-byte placeholder that only a later admin listing of its folder removes (after 70 minutes); a preview whose branches are gone never lists again, so its placeholders stay until deleted by hand.
4. Preview and Production share the Blob store `personal-site-blob-public`, so a preview admin can delete a file the live site uses; give Preview its own store, connected to Preview only.
5. The empty private Blob store `personal.site-blob` is unused and can be deleted.
6. `check:secrets --build` skips private terms shorter than 6 characters (4 of the 17); only `check:content` covers those.
7. `public/media/site/img-7414.webp` is 4.4 MB, above the admin's 4 MB repository limit (the v2 admin uploaded it); recompress it or move it to Blob.
8. The save bar's status text swaps without Motion+ `ScrambleText`; add it in Phase 5 stage 2, now that `MOTION_TOKEN` is set in Vercel.
9. A Word file gets no poster.
10. Models are not offered for download; the schema has no per-file choice yet (Q-24).
11. Models other than STEP, and Word files, are read on the page, not in a worker as `ARCHITECTURE.md` 11 asks; they are capped at 150 MB and 50 MB instead.
12. Old binary `.doc`, `.xls`, and `.ppt` files are refused, where `ARCHITECTURE.md` 13A takes other office formats in as a `file` download.
13. Files go to the repository up to 4 MB, not the 10 MB of `ARCHITECTURE.md` 13A; Blob takes everything larger.
14. The login count across server instances is best effort (four instances allow 8 attempts, not 5); the firewall rule, once enforced, is the exact limit.
15. The firewall rule "Admin login limit" is in log mode; it is enforced only when the owner says (`docs/ADMIN_GUIDE.md`, the firewall section).
16. Safari, Firefox, and a real phone are untested.
17. GitHub still has the branch `claude/portfolio-admin-dashboard-OQLaX` from before v3; delete it if nothing needs it.
