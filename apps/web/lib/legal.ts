export interface OperatorDetails {
  legalName: string;
  tradingName: string;
  registrationNumber: string;
  address: readonly string[];
  jurisdiction: string;
  licenceAuthority: string;
  licenceNumber: string;
  supportEmail: string;
  privacyEmail: string;
  dpoName: string;
  siteUrl: string;
  minimumAge: number;
}

const PLACEHOLDER = '[TO BE COMPLETED]';

export const OPERATOR: OperatorDetails = {
  legalName: PLACEHOLDER,
  tradingName: 'FRIGAT',
  registrationNumber: PLACEHOLDER,
  address: [PLACEHOLDER],
  jurisdiction: PLACEHOLDER,
  licenceAuthority: '',
  licenceNumber: '',
  supportEmail: PLACEHOLDER,
  privacyEmail: PLACEHOLDER,
  dpoName: '',
  
  siteUrl: (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    'https://frigat.casino'
  ).replace(/\/$/, ''),
  minimumAge: 18,
};

const REQUIRED_FIELDS: readonly (keyof OperatorDetails)[] = [
  'legalName',
  'registrationNumber',
  'jurisdiction',
  'supportEmail',
  'privacyEmail',
];

export const LEGAL_DETAILS_INCOMPLETE: boolean =
  REQUIRED_FIELDS.some((field) => {
    const value = OPERATOR[field];
    return typeof value === 'string' && (value === PLACEHOLDER || value.trim() === '');
  }) || OPERATOR.address.some((line) => line === PLACEHOLDER);

export const IS_LICENSED: boolean =
  OPERATOR.licenceAuthority.trim() !== '' && OPERATOR.licenceNumber.trim() !== '';

export const LEGAL_LAST_UPDATED = '2026-08-29';
