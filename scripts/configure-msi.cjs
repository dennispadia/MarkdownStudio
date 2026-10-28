const { readFile, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');

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
  const upgradeCode = xml.match(/<Product\b[^>]*\bUpgradeCode="([A-Fa-f0-9-]+)"/)?.[1];
  if (!upgradeCode) throw new Error('Unexpected MSI template: missing product upgrade identity.');
  const directories = new Set();
  const sources = new Set();
  xml = xml.replace(/<Component(\s[^>]*)?>([\s\S]*?)<\/Component>/g, (_, attributes = '', contents) => {
    const files = [...contents.matchAll(/<File\b[^>]*\bSource="([^"]+)"[^>]*>/g)];
    if (files.length !== 1 || !contents.includes('KeyPath="yes"')) {
      throw new Error('Unexpected MSI template: expected one keyed file per component.');
    }
    const source = files[0][1];
    if (sources.has(source)) throw new Error('Unexpected MSI template: duplicate component file.');
    sources.add(source);
    const id = createHash('sha256').update(source).digest('hex').slice(0, 32);
    if (/\bGuid=/.test(attributes)) throw new Error('Unexpected MSI template: component already has a GUID.');
    const bytes = createHash('sha1')
      .update(Buffer.from(upgradeCode.replace(/-/g, ''), 'hex')).update(source).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const guid = bytes.toString('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const directory = attributes.match(/\bDirectory="([^"]+)"/)?.[1] ?? 'APPLICATIONFOLDER';
    const shortcuts = [...contents.matchAll(/<Shortcut\b[^>]*?(?:\/>|>[\s\S]*?<\/Shortcut>)/g)].map(match => match[0]);
    contents = contents.replace(/<Shortcut\b[^>]*?(?:\/>|>[\s\S]*?<\/Shortcut>)/g, '');
    contents = contents.replace('KeyPath="yes"', 'KeyPath="no"');
    let cleanup = '';
    if (!directories.has(directory)) {
      directories.add(directory);
      cleanup = `<RemoveFolder Id="remove_${id}" Directory="${directory}" On="uninstall"/>`;
    }
    const fileId = files[0][0].match(/\bId="([^"]+)"/)?.[1];
    if (shortcuts.length && !fileId) throw new Error('Unexpected MSI template: shortcut file has no identifier.');
    const links = shortcuts.map(shortcut => {
      if (!shortcut.includes('Advertise="yes"')) throw new Error('Unexpected MSI template: expected advertised shortcut.');
      return shortcut.replace('Advertise="yes"', `Advertise="no" Target="[#${fileId}]"`);
    }).join('\n');
    return `<Component${attributes} Guid="${guid}">${contents}
        <RegistryValue Root="HKCU" Key="Software\\${upgradeCode}\\InstallerComponents" Name="${id}" Type="integer" Value="1" KeyPath="yes"/>
        ${cleanup}
        ${links}
      </Component>`;
  });
  if (!sources.size) throw new Error('Unexpected MSI template: no file components found.');
  return xml;
}

module.exports = async function configureMsi(projectFile) {
  await writeFile(projectFile, configurePerUserMsi(await readFile(projectFile, 'utf8')));
};
module.exports.configurePerUserMsi = configurePerUserMsi;
