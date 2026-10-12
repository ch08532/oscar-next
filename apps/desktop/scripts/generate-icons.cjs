// Rasterize the sidebar's blue Activity mark using the installed Chromium.
const { app, BrowserWindow } = require("electron");
const { readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

app.whenReady().then(async () => {
  const assets = path.resolve(__dirname, "../assets");
  const svg = await readFile(path.join(assets, "icon.svg"), "utf8");
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await window.loadURL("about:blank");
    const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
    const encoded = await window.webContents.executeJavaScript(`(async () => {
      const image = new Image();
      image.src = ${JSON.stringify(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)};
      await image.decode();
      return ${JSON.stringify(sizes)}.map(size => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        canvas.getContext("2d").drawImage(image, 0, 0, size, size);
        return canvas.toDataURL("image/png").split(",")[1];
      });
    })()`);
    const images = encoded.map(data => Buffer.from(data, "base64"));
    await writeFile(path.join(assets, "icon.png"), images.at(-1));
    // ICO contains PNG frames through 256px; zero in the directory denotes 256.
    const frames = images.slice(0, -1);
    const directory = Buffer.alloc(6 + frames.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(frames.length, 4);
    let offset = directory.length;
    frames.forEach((frame, index) => {
      const entry = 6 + index * 16;
      directory[entry] = directory[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
      directory.writeUInt16LE(1, entry + 4);
      directory.writeUInt16LE(32, entry + 6);
      directory.writeUInt32LE(frame.length, entry + 8);
      directory.writeUInt32LE(offset, entry + 12);
      offset += frame.length;
    });
    await writeFile(path.join(assets, "icon.ico"), Buffer.concat([directory, ...frames]));
    console.log("Generated OSCAR Next PNG and multi-size Windows ICO.");
  } finally { window.destroy(); }
}).then(() => app.quit()).catch(error => { console.error(error); app.exit(1); });
