import { registerLicense } from "@syncfusion/ej2-base";

const syncfusionLicenseKey = process.env.NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY?.trim();

if (syncfusionLicenseKey) {
  registerLicense(syncfusionLicenseKey);
}

export const syncfusionLicenseRegistered = Boolean(syncfusionLicenseKey);
