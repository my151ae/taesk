import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: "APIs-Google",
                allow: "/api/integrations/google-calendar/webhook",
            },
            {
                userAgent: "*",
                allow: "/",
                disallow: [
                    "/private/",
                    "/api/auth/",
                ],
            },
        ],
        // Explicitly allow Google's bot for Calendar Webhooks just in case
        // (Though generic * allow should cover it, being explicit helps with Vercel pre-production environments potentially)
        host: "https://taesk.vercel.app",
    };
}
