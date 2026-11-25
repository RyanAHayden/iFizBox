# B431 install log stays up

Removed startIncoming visibilitychange dismiss (B175) in web/app/incoming.js; clearRunPage for links kept. queuerun.js has no return-close; followHandoff in apprun.js untouched. Test flipped: finished and running runs both stay after hidden/visible.

**Not verified**: on-device behaviour (none run).
