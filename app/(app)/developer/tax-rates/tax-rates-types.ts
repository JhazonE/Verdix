export interface TaxRateFormData {
  name: string;
  rate: string;
  description: string;
  isDefault: boolean;
}

export const FORM_DEFAULTS: TaxRateFormData = {
  name: '',
  rate: '',
  description: '',
  isDefault: false,
};
