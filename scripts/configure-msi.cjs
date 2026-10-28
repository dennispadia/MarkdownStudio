const { readFile, writeFile } = require('node:fs/promises');

function configurePerUserMsi(xml) {
  // The builder's dual-scope template must be restricted to a non-elevated, current-user installation.
  const replacements = [
    ['<Package Compressed="yes" InstallerVersion="500"/>', '<Package Compressed="yes" InstallerVersion="500" InstallScope="perUser"/>'],
    ['<Property Id="ALLUSERS" Secure="yes" Value="2"/>', ''],
    ['<Directory Id="ProgramFiles64Folder">', '<Directory Id="LocalAppDataFolder">'],
  ];
  for (const [before, after] of replacements) {
    if (xml.split(before).length !== 2) throw new Error(`Unexpected MSI template: expected exactly one ${before}. Review the per-user installer hook before releasing.`);
    xml = xml.replace(before, after);
  }
  return xml;
}

module.exports = async function configureMsi(projectFile) {
  await writeFile(projectFile, configurePerUserMsi(await readFile(projectFile, 'utf8')));
};
module.exports.configurePerUserMsi = configurePerUserMsi;
