<!--
 Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
 Licensed under the Apache License, Version 2.0.
-->

# `microapp.json` — notes for whoever publishes this

`displayMode` is `fullscreen`: the rally owns the whole screen, with no super app
header above it. A navigator glancing at a cradle should see the course, not
chrome.

`requiredPermissions: ["location"]` is **not yet a field the super app
understands.** It is proposed in `docs/plans/2026-08-10-superapp-location.md`
(`SA-5`) so that location is granted per micro app rather than to every app the
store hosts. Until that lands the field is inert — harmless, and it records the
intent where a publisher will see it.

`clientId`, the three `<host>` URLs and the `versions[].downloadUrl` are
placeholders. Fill them when the app is first published:

1. `npm run package` → `rally-microapp.zip`, contents at the **root** of the
   archive, not nested inside `dist/`.
2. Host the zip, the icon and the banner.
3. Point `downloadUrl` at the zip and register the `micro_app` /
   `micro_app_version` rows in the super app.
