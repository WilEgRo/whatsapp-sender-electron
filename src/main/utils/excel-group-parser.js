const XLSX = require('xlsx');
const COUNTRY_CODES = new Set([
  '1', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49',
  '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '7', '81', '82', '84',
  '86', '90', '91', '92', '93', '94', '95', '98', '211', '212', '213', '216', '218', '220', '221', '222', '223', '224',
  '225', '226', '227', '228', '229', '230', '231', '232', '233', '234', '235', '236', '237', '238', '239', '240', '241',
  '242', '243', '244', '245', '246', '248', '249', '250', '251', '252', '253', '255', '256', '257', '258', '260', '261',
  '262', '263', '264', '265', '266', '267', '268', '269', '290', '291', '297', '298', '299', '350', '351', '352', '353',
  '354', '355', '356', '357', '358', '359', '370', '371', '372', '373', '374', '375', '376', '377', '378', '379', '380',
  '381', '382', '383', '385', '386', '387', '389', '420', '421', '423', '500', '501', '502', '503', '504', '505', '506',
  '507', '508', '509', '590', '591', '592', '593', '594', '595', '596', '597', '598', '599', '670', '672', '673', '674',
  '675', '676', '677', '678', '679', '680', '681', '682', '683', '685', '686', '687', '688', '689', '690', '691', '692',
  '850', '852', '853', '855', '856', '880', '886', '960', '961', '962', '963', '964', '965', '966', '967', '968', '970',
  '971', '972', '973', '974', '975', '976', '977', '992', '993', '994', '995', '996', '998'
]);

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normalizePhone(value) {
  const rawValue = String(value || '').trim();
  if (/[a-z@]/i.test(rawValue)) {
    return '';
  }
  const digits = rawValue.replace(/[^0-9]/g, '');
  const countryCode = ['3', '2', '1'].map((length) => digits.slice(0, length)).find((code) => COUNTRY_CODES.has(code));
  const hasRecognizedCountryCode = Boolean(countryCode);
  const hasReasonableLength = digits.length >= countryCode.length + 6 && digits.length <= 15;
  const hasRequiredLengthForSeven = countryCode !== '7' || digits.length === 11;
  return hasRecognizedCountryCode && hasReasonableLength && hasRequiredLengthForSeven && !/^0+$/.test(digits) ? digits : '';
}

function extractNumbers(value) {
  return String(value || '')
    .split(/[,;\n|]+/)
    .map(normalizePhone)
    .filter(Boolean);
}

function parseExcelParticipants(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('El archivo Excel esta vacio');
  }

  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('El archivo no contiene hojas validas');
  }

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('El archivo Excel no contiene datos');
  }

  const keys = Object.keys(rows[0] || {});
  const numberKey = keys.find((key) => normalizeHeader(key) === 'numero');
  if (!numberKey) {
    throw new Error('El Excel debe contener una columna llamada numero');
  }

  const nameKey = keys.find((key) => normalizeHeader(key) === 'nombre');
  const participants = [];
  const errors = [];
  const seen = new Set();

  rows.forEach((row, index) => {
    const rawValue = row[numberKey];
    if (String(rawValue || '').trim() === '') {
      return;
    }

    const numbers = extractNumbers(rawValue);
    if (numbers.length === 0) {
      errors.push({ fila: index + 2, etapa: 'validacion', error: 'Numero invalido' });
      participants.push({
        name: String(nameKey ? row[nameKey] || '' : '').trim(),
        number: String(rawValue || '').trim(),
        originalIndex: index + 1,
        originalRow: index + 2,
        invalid: true
      });
      return;
    }

    numbers.forEach((number) => {
      if (!seen.has(number)) {
        seen.add(number);
        participants.push({
          name: String(nameKey ? row[nameKey] || '' : '').trim(),
          number,
          originalIndex: index + 1,
          originalRow: index + 2
        });
      } else {
        errors.push({ fila: index + 2, numero: number, etapa: 'validacion', error: 'Numero duplicado; se conserva la primera aparicion' });
      }
    });
  });

  if (participants.length === 0) {
    throw new Error('El Excel no contiene numeros validos en la columna numero');
  }

  return { participants, errors };
}

module.exports = { parseExcelParticipants };