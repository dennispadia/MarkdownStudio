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

Publish an installer only after packaging and verification both succeed. Local Windows policy may block validation even when the hosted workflow succeeds; see [installer validation and policy restrictions](BUILDING.md#installer-validation-status-and-policy-restrictions).

Run the commands in order, not concurrently:

```powershell
npm.cmd ci --registry=https://registry.npmjs.org
npm.cmd test
npm.cmd run package:msi
npm.cmd run verify:msi
npm.cmd run package:source
npm.cmd run release:checksums
```

For later releases, increment `version` using `npm version <version> --no-git-tag-version`, keep the lockfile synchronized, and update the changelog.

On GitHub:

1. Open the repository's **Releases > Draft a new release**.
2. Create a tag matching the version, such as `v0.5.0`, targeting the reviewed commit.
3. Add a description of the release, known limitations, the unsigned-installer warning, and the no-support policy.
4. Attach these files from `release`:
   - `Markdown-Studio-<version>-x64.msi`
   - `MarkdownStudio-<version>-source.zip`
   - `SHA256SUMS.txt`
5. Publish the release when satisfied.

**Do not commit installers, unpacked executables, `node_modules`, or tool downloads to Git.** Release assets are the right place for downloadable binaries. A checksum detects accidental changes but does not authenticate a publisher; code signing is a separate step.

## GitHub Actions

The included Windows workflow runs on pushes to `main` and on manual dispatch. It restores locked dependencies from the public npm registry, runs unit tests, builds/verifies the MSI, and creates source/checksum artifacts.

The workflow has read-only repository permissions and **does not automatically create releases or upload binaries to a public Release**. Download its build artifacts and publish reviewed release assets manually. GitHub may require you to enable Actions in a new repository or fork; Actions availability, limits and billing are controlled by GitHub.

Review the screenshots and source archive before making the repository public. No remote, account credentials, or GitHub token is embedded in this project.
