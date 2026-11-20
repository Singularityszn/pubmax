import "server-only";
import { isEmailProviderConfigured } from "@/lib/emailProviderConfigured.mjs";

export const paydayFeatureEnabled = () => process.env.PAYDAY_PINT_ENABLED === "1";
export const paydayDeliveryReady = () => paydayFeatureEnabled() && process.env.PAYDAY_PINT_DELIVERY_ENABLED === "1" && isEmailProviderConfigured() && Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim() && process.env.PAYDAY_PINT_POSTAL_ADDRESS?.trim());
