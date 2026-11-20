const blueSeed = '#2563eb';
const paperSeed = '#37664f';

function selectedPalette(palette) {
  return palette === 'blue' || palette === 'custom' ? palette : 'paper';
}

function customSeed(accent) {
  return /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : paperSeed;
}

export function applyPalette(settings) {
  const palette = selectedPalette(settings.palette);
  document.body.dataset.palette = palette;
  document.body.style.setProperty('--reader-seed', palette === 'blue' ? blueSeed : customSeed(settings.accent));
}

export function createReadingSettings({ button, getSettings, onChange }) {
  const panel = document.createElement('section');
  panel.className = 'reader-settings-panel';
  panel.id = 'md-reader-settings-panel';
  panel.setAttribute('aria-label', '阅读设置');
  panel.hidden = true;
  panel.innerHTML = `<header class="reader-settings-heading"><h2>阅读设置</h2><button type="button" class="reader-button reader-icon-button" aria-label="关闭阅读设置">×</button></header>
    <fieldset>
      <legend>字号</legend>
      <div class="reader-size-control">
        <button type="button" class="reader-button reader-icon-button" data-size="-1" aria-label="缩小字号">−</button>
        <output aria-live="polite"></output>
        <button type="button" class="reader-button reader-icon-button" data-size="1" aria-label="放大字号">+</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>版心</legend>
      <div class="reader-segmented">
        <button type="button" data-width="standard">标准</button>
        <button type="button" data-width="wide">宽版</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>明暗模式</legend>
      <div class="reader-segmented">
        <button type="button" data-theme-choice="system">跟随系统</button>
        <button type="button" data-theme-choice="light">浅色</button>
        <button type="button" data-theme-choice="dark">深色</button>
      </div>
    </fieldset>
    <fieldset>
      <legend>配色</legend>
      <div class="reader-segmented reader-palette-options">
        <button type="button" data-palette-choice="paper"><span class="reader-swatch reader-swatch-paper" aria-hidden="true"></span>纸感绿</button>
        <button type="button" data-palette-choice="blue"><span class="reader-swatch reader-swatch-blue" aria-hidden="true"></span>标准蓝</button>
      </div>
      <label class="reader-custom-color"><span>自定义主题色</span><input type="color" value="${paperSeed}"></label>
    </fieldset>`;
  const colorInput = panel.querySelector('input');
  const paletteChoices = panel.querySelectorAll('[data-palette-choice]');
  const themeChoices = panel.querySelectorAll('[data-theme-choice]');
  const widthChoices = panel.querySelectorAll('[data-width]');
  const [smaller, larger] = panel.querySelectorAll('[data-size]');
  const sizeOutput = panel.querySelector('output');
  const closeButton = panel.querySelector('.reader-settings-heading button');
  const customColor = panel.querySelector('.reader-custom-color');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panel.id);
  button.after(panel);

  const sync = () => {
    const settings = getSettings();
    const palette = selectedPalette(settings.palette);
    const size = fontSize(settings.size);
    sizeOutput.value = `${size} px`;
    smaller.disabled = size <= 14;
    larger.disabled = size >= 24;
    paletteChoices.forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.paletteChoice === palette)));
    themeChoices.forEach(choice => choice.setAttribute('aria-pressed', String(choice.dataset.themeChoice === settings.theme)));
    widthChoices.forEach(choice => choice.setAttribute('aria-pressed', String((choice.dataset.width === 'wide') === Boolean(settings.wide))));
    colorInput.value = customSeed(settings.accent);
    customColor.classList.toggle('active', palette === 'custom');
  };
  const close = (restoreFocus = false) => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  };
  button.addEventListener('click', () => {
    if (!panel.hidden) { close(true); return; }
    sync();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  });
  closeButton.addEventListener('click', () => close(true));
  const update = change => { onChange(change); sync(); };
  smaller.addEventListener('click', () => update({ size: fontSize(fontSize(getSettings().size) - 1) }));
  larger.addEventListener('click', () => update({ size: fontSize(fontSize(getSettings().size) + 1) }));
  paletteChoices.forEach(choice => choice.addEventListener('click', () => update({ palette: choice.dataset.paletteChoice })));
  themeChoices.forEach(choice => choice.addEventListener('click', () => update({ theme: choice.dataset.themeChoice })));
  widthChoices.forEach(choice => choice.addEventListener('click', () => update({ wide: choice.dataset.width === 'wide' })));
  colorInput.addEventListener('input', () => update({ palette: 'custom', accent: colorInput.value }));
  colorInput.addEventListener('change', () => update({ palette: 'custom', accent: colorInput.value }));
  document.addEventListener('pointerdown', event => {
    if (!panel.hidden && !panel.contains(event.target) && !button.contains(event.target)) close();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(true); }
  });
  return { sync, close };
}

export function fontSize(value) {
  return Math.min(24, Math.max(14, Number(value) || 17));
}
