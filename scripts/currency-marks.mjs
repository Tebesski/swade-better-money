const graphemes = new Intl.Segmenter(undefined, {granularity: "grapheme"});
export const MAX_CURRENCY_SYMBOLS = 3;

export function currencyCharacters(text) {
  return Array.from(graphemes.segment(String(text ?? "")), entry => entry.segment);
}

export function currencyMark(currency = {}) {
  const images = [currency.image || currency.image2 || currency.image3].filter(Boolean);
  const text = currencyCharacters(currency.symbol).slice(0, MAX_CURRENCY_SYMBOLS).join("");
  return {images, text: images.length ? "" : text};
}

export function createCurrencyMark(doc, currency) {
  const {images, text} = currencyMark(currency);
  const mark = doc.createElement("span");
  mark.className = "better-money-currency-mark";
  mark.setAttribute("aria-hidden", "true");
  for (const path of images) {
    const icon = doc.createElement("img");
    icon.src = path;
    icon.alt = "";
    mark.append(icon);
  }
  if (text) mark.textContent = text;
  else if (!images.length) {
    const icon = doc.createElement("i");
    icon.className = "fa-solid fa-coins";
    mark.append(icon);
  }
  return mark;
}
