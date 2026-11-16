# Changelog

## 0.1.0 (2026-11-16)


### Features

* **cli:** gentle-profiles launcher with first-run default profile ([96d85d3](https://github.com/fcireza/gentle-profiles/commit/96d85d3c3cd7ed2dee11dc29fdd48880ed88e47a))
* **extension:** /profile command with credential switch and default profile ([319c60f](https://github.com/fcireza/gentle-profiles/commit/319c60fb15e858900995a230d7a710b064b4aada))
* **status:** show the active profile and Claude account in the status bar ([91326c3](https://github.com/fcireza/gentle-profiles/commit/91326c3ce4015b6063f48122b9c03089581f99bc))
* **store:** profile store with name validation and layout ([e04f27d](https://github.com/fcireza/gentle-profiles/commit/e04f27d89dd5ba2eab82763bcc158fba47169d07))


### Bug Fixes

* **auth-sync:** fail atomically on corrupt auth files ([457ada7](https://github.com/fcireza/gentle-profiles/commit/457ada7d92482c063c416c7a61fc2f154c7a5476))
* **cli:** validate the target before creating default; e2e launcher tests and CI matrix ([97377c6](https://github.com/fcireza/gentle-profiles/commit/97377c6c6012e5625586ca13f1ce9d89939ffc15))
* **profiles:** keep CLAUDE_CONFIG_DIR unset for the default login; masked account status ([#2](https://github.com/fcireza/gentle-profiles/issues/2)) ([bc35061](https://github.com/fcireza/gentle-profiles/commit/bc35061bd84ad272b1300f42ca2ec17d7d8c05f6))
