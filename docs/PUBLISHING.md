# Publishing to GitHub and sharing releases

Preparing source does not publish it. You decide the GitHub account, repository name, and visibility. Do not include personal documents or credentials.

## Easiest path: GitHub Desktop

1. Install GitHub Desktop from its official website and sign in.
2. Choose **File > Add local repository** and select the project root. If it is not a Git repository, choose the offered **create a repository here** option, using the existing project folder.
3. Review the files in the initial change list. Commit source, tests, documentation, screenshots, artwork, package manifests/lockfile, and `.github` configuration.
4. Confirm that `.tools`, `node_modules`, `build`, `dist`, `release`, `.env`, `.npmrc`, private certificates, and personal documents are **not** selected. `.gitignore` handles the known generated/private paths.
5. Create the initial commit, then choose **Publish repository**. Select your account, a repository name, and public/private visibility.
6. Follow the [no-support policy](../SUPPORT.md): in repository **Settings > General > Features**, disable Issues and Discussions if enabled, and consider disabling Wiki/Projects. Pull requests cannot be disabled in the same way; the contribution policy explains that upstream changes are not solicited.

GitHub's browser uploader does not apply `.gitignore` for you. Do not drag the entire working folder into it. If needed, extract the generated clean source ZIP into a separate folder and use that reviewed source-only copy.

## Create release downloads

The repository is `dennispadia/lekh`. Version 0.7.1 adds the native offline premium EXE installer to the branding introduced in 0.7.0, without changing editor features. Previous Markdown Studio releases and their downloadable assets have been retired; Git tags and source history are retained. The application executable is `Lekh - Markdown editor.exe`; existing Windows associations and pinned shortcuts may need to be reselected. The internal MSI upgrade identity and existing settings/recovery profile are retained.

Publish an installer only after packaging and verification both succeed. Local Windows policy may block validation even when the hosted workflow succeeds; see [installer validation and policy restrictions](BUILDING.md#installer-validation-status-and-policy-restrictions).

Run the commands in order, not concurrently:

```powershell
npm.cmd ci --registry=https://registry.npmjs.org
npm.cmd test
npm.cmd run package:msi
npm.cmd run verify:msi
npm.cmd run build:setup
npm.cmd run verify:setup
npm.cmd run package:source
npm.cmd run release:checksums
```

For later releases, increment `version` using `npm version <version> --no-git-tag-version`, keep the lockfile synchronized, and update the changelog.

**Validation and release status:** the premium EXE is version **0.7.1**; 0.7.0 remains the published download until the new build and release verification finish. All editor features and storage identities are retained. The Windows build checks the internal MSI and full extracted-application desktop suite, compiles the EXE, runs native engine/story tests, verifies its embedded payload, and exercises safe native setup previews. Actual installation tests are explicitly gated to a clean GitHub-hosted runner; they install through the real setup UI and verify per-user registration, uninstall, and preservation of the separate recovery profile. Genuine old-version upgrades and repair still need a disposable-VM test matrix. Keep these distinctions in release notes. The publisher verifies build identity, artifact digest, and exact public checksums before release; neither workflow signs artifacts or enforces Authenticode signatures. Keep the unsigned-software warning until trusted signing is implemented and verified.

On GitHub:

1. Open the repository's **Releases > Draft a new release**.
2. Create a tag matching the version, such as `v0.7.1`, targeting the reviewed commit.
3. Add a description of the release, known limitations, the unsigned-installer warning, and the no-support policy.
4. Attach these files from `release`:
   - `Lekh-Markdown-editor-Setup-<version>-x64.exe`
   - `Lekh-<version>-source.zip`
   - `SHA256SUMS.txt`
5. Publish the release when satisfied.

**Do not commit installers, unpacked executables, `node_modules`, or tool downloads to Git.** Release assets are the right place for downloadable binaries. A checksum detects accidental changes but does not authenticate a publisher; code signing is a separate step.

## GitHub Actions

The included Windows workflow runs on pushes to `main` and on manual dispatch. It restores locked dependencies from the public npm registry, runs unit tests, builds/verifies the internal MSI and native setup EXE, and creates source/checksum artifacts. Public artifacts contain only the setup EXE, source ZIP, and checksum list, not the internal MSI.

The workflow has read-only repository permissions and **does not automatically create releases or upload binaries to a public Release**. Download its build artifacts and publish reviewed release assets manually. GitHub may require you to enable Actions in a new repository or fork; Actions availability, limits and billing are controlled by GitHub.

Alternatively, run **Actions > Publish verified release > Run workflow** and enter the run ID of a successful **Windows build** on `main`. This manually triggered publisher verifies the build's identity, artifact digest and file checksums, then attaches the setup EXE, source ZIP and checksums to a Release tagged with the built version. Only its publishing job has repository write permission. It refuses to overwrite a published release or reuse a draft targeting another build.

To retire an older MSI download, first publish and independently verify the replacement EXE and source checksums. Then delete only the superseded release's MSI asset and replace that old release's checksum list with checksums for its remaining assets. Update its release notes to link to the replacement. Preserve tags, source ZIPs, and immutable published binaries; do not leave checksums or current documentation pointing at deleted assets.

Review the screenshots and source archive before making the repository public. No remote, account credentials, or GitHub token is embedded in this project.

## Code signing policy (pending)

No signing provider is configured, and no trusted certificate is currently available to this project. The existing Electron packaging configuration deliberately disables executable signing; changing a version number or passing CI does not change that status. Published 0.5.0, 0.5.1, and 0.6.0 assets remain unsigned and must not be replaced.

The planned no-cost route is [SignPath Foundation's open-source program](https://signpath.org/). Acceptance is discretionary, not automatic: its [conditions](https://signpath.org/terms) require an OSI-approved license, an actively maintained and already released project, verifiable project reputation/control, MFA, defined signing roles, and manual approval of signing requests. The Foundation is the certificate publisher. This preparation does not claim that the project has been accepted or that signing is already provided by SignPath.

### Maintainer enrollment

1. Review the current [SignPath conditions](https://signpath.org/terms) and [apply](https://signpath.org/apply) for the public repository `https://github.com/dennispadia/lekh`. Provide the existing MIT license, public release, build workflow, and documentation as requested. Account creation, policy acceptance, MFA, and submission require the maintainer's participation.
2. Confirm eligibility with SignPath, including project reputation, maintenance expectations, and the Electron application packaging. The no-support policy does not promise future maintenance; do not change that promise or assume acceptance solely because the license is MIT.
3. Identify the authors, reviewers, and signing approvers. Once accepted, update this policy with the confirmed roles and the attribution required by SignPath. Retain the application's [privacy description](USER_GUIDE.md#privacy); do not claim enrollment or sponsorship before approval.
4. Configure the approved repository/build integration and artifact policies with SignPath. Keep API tokens and other secrets in GitHub Actions secrets, never source code, release assets, logs, or chat. Organization/project identifiers and artifact/signing policy names must come from the approved account, not guessed placeholders.

### Required work after approval

- Integrate signing into the build at the correct stages: sign the customized application executable before it is embedded in the MSI, then sign the final MSI. Do not re-sign unrelated upstream binaries under this project's identity.
- Restrict signing to the approved repository, reviewed commits, product name/version, and artifact paths. Require maintainer approval for each release as specified by the provider.
- Verify the final MSI and its extracted application executable have valid, trusted Authenticode signatures with the approved publisher identity. A signature merely being present is insufficient. Verify the timestamp and trust chain, and rerun installer/payload and desktop validation on the final signed artifacts.
- Update the publisher to reject unsigned, invalidly signed, or unexpected-publisher artifacts before enabling publication. Its current digest/checksum checks do not replace signature validation.
- Generate checksums **after** signing. Publish the exact verified signed MSI with the matching source ZIP and checksums under a new version greater than **0.6.0**. Never replace existing published assets, including the unsigned 0.5.0, 0.5.1, and 0.6.0 releases. Update README download links only after the new release is verified live.

### Warnings and limitations

Code signing establishes publisher identity and detects tampering; it does not guarantee warning-free downloads. [Microsoft's SmartScreen guidance](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation) explains that even trusted OV/EV signatures may show warnings until reputation builds. Self-signed certificates behave like unsigned downloads for public users and are not an acceptable substitute. Do not ask users to disable security protections or install a custom root certificate.

Microsoft Store distribution is a separate option for avoiding SmartScreen download warnings for Store-installed apps. It requires its own packaging, enrollment, and certification process; it does not make an MSI downloaded from GitHub warning-free.
