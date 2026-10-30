// Object identifiers used when decoding X.509 certificates.

/** Attribute types that appear in subject / issuer names. */
export const NAME_ATTRIBUTES = {
  '2.5.4.3': 'CN',
  '2.5.4.4': 'SN',
  '2.5.4.5': 'serialNumber',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.9': 'street',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.12': 'title',
  '2.5.4.15': 'businessCategory',
  '2.5.4.17': 'postalCode',
  '2.5.4.42': 'GN',
  '2.5.4.97': 'organizationIdentifier',
  '1.2.840.113549.1.9.1': 'emailAddress',
  '0.9.2342.19200300.100.1.1': 'UID',
  '0.9.2342.19200300.100.1.25': 'DC',
  '1.3.6.1.4.1.311.60.2.1.1': 'jurisdictionL',
  '1.3.6.1.4.1.311.60.2.1.2': 'jurisdictionST',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionC',
};

export const PUBLIC_KEY_ALGORITHMS = {
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.10045.2.1': 'EC',
  '1.3.101.110': 'X25519',
  '1.3.101.111': 'X448',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '1.2.840.10040.4.1': 'DSA',
};

export const EC_CURVES = {
  '1.2.840.10045.3.1.7': { name: 'P-256', bits: 256 },
  '1.3.132.0.34': { name: 'P-384', bits: 384 },
  '1.3.132.0.35': { name: 'P-521', bits: 521 },
  '1.3.132.0.10': { name: 'secp256k1', bits: 256 },
  '1.3.36.3.3.2.8.1.1.7': { name: 'brainpoolP256r1', bits: 256 },
  '1.3.36.3.3.2.8.1.1.11': { name: 'brainpoolP384r1', bits: 384 },
  '1.3.36.3.3.2.8.1.1.13': { name: 'brainpoolP512r1', bits: 512 },
};

export const SIGNATURE_ALGORITHMS = {
  '1.2.840.113549.1.1.4': 'MD5 with RSA',
  '1.2.840.113549.1.1.5': 'SHA-1 with RSA',
  '1.2.840.113549.1.1.10': 'RSA-PSS',
  '1.2.840.113549.1.1.11': 'SHA-256 with RSA',
  '1.2.840.113549.1.1.12': 'SHA-384 with RSA',
  '1.2.840.113549.1.1.13': 'SHA-512 with RSA',
  '1.2.840.113549.1.1.14': 'SHA-224 with RSA',
  '1.2.840.10045.4.1': 'ECDSA with SHA-1',
  '1.2.840.10045.4.3.1': 'ECDSA with SHA-224',
  '1.2.840.10045.4.3.2': 'ECDSA with SHA-256',
  '1.2.840.10045.4.3.3': 'ECDSA with SHA-384',
  '1.2.840.10045.4.3.4': 'ECDSA with SHA-512',
  '1.3.101.112': 'Ed25519',
  '1.3.101.113': 'Ed448',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '1.2.840.10040.4.3': 'DSA with SHA-1',
};

/** Signature algorithms that browsers no longer accept for TLS certificates. */
export const WEAK_SIGNATURES = new Set([
  '1.2.840.113549.1.1.4',
  '1.2.840.113549.1.1.5',
  '1.2.840.10045.4.1',
  '1.2.840.10040.4.3',
]);

export const EXTENDED_KEY_USAGES = {
  '1.3.6.1.5.5.7.3.1': 'serverAuth',
  '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning',
  '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping',
  '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  '2.5.29.37.0': 'anyExtendedKeyUsage',
  '1.3.6.1.4.1.311.10.3.3': 'msSGC',
  '2.16.840.1.113730.4.1': 'nsSGC',
};

export const KEY_USAGE_BITS = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

/** CA/Browser Forum policy identifiers → validation level. */
export const VALIDATION_POLICIES = {
  '2.23.140.1.1': 'EV',
  '2.23.140.1.2.1': 'DV',
  '2.23.140.1.2.2': 'OV',
  '2.23.140.1.2.3': 'IV',
};

export const POLICY_NAMES = {
  '2.23.140.1.1': 'CA/B Forum EV',
  '2.23.140.1.2.1': 'CA/B Forum DV',
  '2.23.140.1.2.2': 'CA/B Forum OV',
  '2.23.140.1.2.3': 'CA/B Forum IV',
  '2.5.29.32.0': 'anyPolicy',
  '1.3.6.1.4.1.44947.1.1.1': 'ISRG Domain Validated',
};

export const EXTENSIONS = {
  SUBJECT_KEY_ID: '2.5.29.14',
  KEY_USAGE: '2.5.29.15',
  SUBJECT_ALT_NAME: '2.5.29.17',
  BASIC_CONSTRAINTS: '2.5.29.19',
  NAME_CONSTRAINTS: '2.5.29.30',
  CRL_DISTRIBUTION_POINTS: '2.5.29.31',
  CERTIFICATE_POLICIES: '2.5.29.32',
  AUTHORITY_KEY_ID: '2.5.29.35',
  EXT_KEY_USAGE: '2.5.29.37',
  AUTHORITY_INFO_ACCESS: '1.3.6.1.5.5.7.1.1',
  TLS_FEATURE: '1.3.6.1.5.5.7.1.24',
  SCT_LIST: '1.3.6.1.4.1.11129.2.4.2',
  CT_POISON: '1.3.6.1.4.1.11129.2.4.3',
};

export const EXTENSION_NAMES = {
  '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.15': 'keyUsage',
  '2.5.29.17': 'subjectAltName',
  '2.5.29.18': 'issuerAltName',
  '2.5.29.19': 'basicConstraints',
  '2.5.29.30': 'nameConstraints',
  '2.5.29.31': 'cRLDistributionPoints',
  '2.5.29.32': 'certificatePolicies',
  '2.5.29.33': 'policyMappings',
  '2.5.29.35': 'authorityKeyIdentifier',
  '2.5.29.36': 'policyConstraints',
  '2.5.29.37': 'extKeyUsage',
  '2.5.29.54': 'inhibitAnyPolicy',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess',
  '1.3.6.1.5.5.7.1.24': 'tlsFeature',
  '1.3.6.1.4.1.11129.2.4.2': 'ctSignedCertificateTimestamps',
  '1.3.6.1.4.1.11129.2.4.3': 'ctPrecertificatePoison',
  '2.16.840.1.113730.1.1': 'netscapeCertType',
  '2.16.840.1.113730.1.13': 'netscapeComment',
};

export const ACCESS_METHODS = {
  OCSP: '1.3.6.1.5.5.7.48.1',
  CA_ISSUERS: '1.3.6.1.5.5.7.48.2',
};
