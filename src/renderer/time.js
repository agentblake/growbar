'use strict';

(function exposeTimeHelpers(root) {
  function normalizeTimeInput(value) {
    const trimmed = String(value).trim();
    const colonTime = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (colonTime) {
      const hours = Number(colonTime[1]);
      const minutes = Number(colonTime[2]);
      if (hours <= 23 && minutes <= 59) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    const digits = trimmed.match(/^(\d{1,2})(\d{2})$/);
    if (digits) {
      const hours = Number(digits[1]);
      const minutes = Number(digits[2]);
      if (hours <= 23 && minutes <= 59) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    return trimmed;
  }

  root.GrowBarTime = { normalizeTimeInput };
  if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeTimeInput };
})(typeof globalThis === 'undefined' ? this : globalThis);
