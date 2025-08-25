class SmartSensitiveSanitizer {
  constructor() {
    this.sensitiveMap = new Map();
    this.counter = 0;
    this.placeholderPrefix = "<SENSITIVE_";
    this.placeholderSuffix = ">";
    this.passwordIndicators = ["password", "pass", "passwd", "pwd", "secret", "token", "apikey", "pin"];
  }

  _generatePlaceholder() {
    return `${this.placeholderPrefix}${this.counter++}${this.placeholderSuffix}`;
  }

  sanitize(prompt) {
    this.sensitiveMap.clear();
    this.counter = 0;
    let result = String(prompt);

    // 1️⃣ Inline separators: john:test123 or john/test123 → mask only password
    result = result.replace(/\b([^\s:\/]+)[:\/]([^\s.,]+)/g, (match, user, pass) => {
      const placeholder = this._generatePlaceholder();
      this.sensitiveMap.set(placeholder, pass);
      return `${user}:${placeholder}`;
    });

    // 2️⃣ Explicit password keywords: password test123, pass:xxx, etc.
    result = result.replace(
      new RegExp(`\\b(${this.passwordIndicators.join("|")})\\b\\s*[:=]?\\s*["']?([^\\s"'.]+)`, "gi"),
      (match, key, value) => {
        const placeholder = this._generatePlaceholder();
        this.sensitiveMap.set(placeholder, value);
        return match.replace(value, placeholder);
      }
    );

    // 3️⃣ Username + password patterns → mask only password
    result = result.replace(/\busername\s+([^\s]+)\s+(?:and\s+)?password\s+([^\s.,]+)/i, (match, user, pass) => {
      const placeholder = this._generatePlaceholder();
      this.sensitiveMap.set(placeholder, pass);
      return match.replace(pass, placeholder);
    });

    // 4️⃣ Credentials pattern: credentials USER PASS → mask only password
    result = result.replace(/\bcredentials\s+([^\s]+)\s+([^\s.,]+)/i, (match, user, pass) => {
      const placeholder = this._generatePlaceholder();
      this.sensitiveMap.set(placeholder, pass);
      return match.replace(pass, placeholder);
    });

    // 5️⃣ Generic login with/using pattern → mask second token if looks like password
    result = result.replace(/\blogin(?:\s+to\s+\S+)?\s+(?:using|with)?\s+([^\s]+)\s+(?:and\s+)?([^\s.,]+)/i, (match, user, pass) => {
      const placeholder = this._generatePlaceholder();
      this.sensitiveMap.set(placeholder, pass);
      return match.replace(pass, placeholder);
    });

    return result;
  }

  restore(input) {
    let restored = String(input);
    for (const [placeholder, value] of this.sensitiveMap.entries()) {
      restored = restored.replaceAll(placeholder, value);
    }
    return restored;
  }
}

module.exports = SmartSensitiveSanitizer;
