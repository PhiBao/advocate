// Filing guides: where and how to send the appeal, per payer.
// URLs are limited to well-known official domains. Anything unknown falls
// back to the generic guide (member portal + number on insurance card).

export interface FilingGuide {
  payer: string;
  portalUrl: string | null;
  steps: string[];
  note: string;
}

const GUIDES: Array<{ match: RegExp; guide: FilingGuide }> = [
  {
    match: /aetna/i,
    guide: {
      payer: "Aetna",
      portalUrl: "https://www.aetna.com",
      steps: [
        "Sign in at aetna.com and open the claim under Claims.",
        "Choose Appeal / Dispute and attach your letter plus the bill or EOB.",
        "Or mail to the appeals address printed on your EOB.",
        "Save the confirmation number and the date you filed.",
      ],
      note: "Aetna typically decides standard appeals within 30 days.",
    },
  },
  {
    match: /united|uhc|oxford/i,
    guide: {
      payer: "UnitedHealthcare",
      portalUrl: "https://www.myuhc.com",
      steps: [
        "Sign in at myuhc.com and open the claim.",
        "Choose Appealing a claim decision and attach your letter plus documents.",
        "Or mail to the appeals address on your EOB.",
        "Save the confirmation number and the date you filed.",
      ],
      note: "You can also call the number on the back of your member ID card.",
    },
  },
  {
    match: /cigna/i,
    guide: {
      payer: "Cigna",
      portalUrl: "https://my.cigna.com",
      steps: [
        "Sign in at my.cigna.com, open the claim, and start an appeal.",
        "Attach your letter plus the bill or EOB.",
        "Or mail to the appeals address on your EOB.",
        "Save the confirmation number and the date you filed.",
      ],
      note: "Keep copies of everything you send.",
    },
  },
  {
    match: /blue\s*cross|blue\s*shield|bcbs|anthem|wellpoint/i,
    guide: {
      payer: "Blue Cross Blue Shield",
      portalUrl: "https://www.bcbs.com",
      steps: [
        "Sign in through your local BCBS plan site (listed on your member card).",
        "Open the claim and file an appeal, attaching your letter and documents.",
        "Or mail to the appeals address on your EOB.",
        "Save the confirmation number and the date you filed.",
      ],
      note: "Each BCBS plan runs its own portal — start from your member card.",
    },
  },
  {
    match: /medicare/i,
    guide: {
      payer: "Medicare",
      portalUrl: "https://www.medicare.gov",
      steps: [
        "Check your Medicare Summary Notice for the appeal deadline and address.",
        "Mail your letter with the MSN to the address in the notice.",
        "Or follow the redetermination instructions at medicare.gov/appeals.",
        "Keep copies and note the date you mailed it.",
      ],
      note: "Medicare redeterminations are usually decided within 60 days.",
    },
  },
];

export const GENERIC_GUIDE: FilingGuide = {
  payer: "your health plan",
  portalUrl: null,
  steps: [
    "Sign in to your insurer's member portal and open the claim.",
    "Choose Appeal / Dispute and attach your letter plus the bill or EOB.",
    "Or mail everything to the appeals address printed on your EOB or letter.",
    "Save the confirmation number and the date you filed.",
  ],
  note: "The appeals address and deadline are printed on your EOB or denial letter — when in doubt, call the number on the back of your insurance card.",
};

export function guideForPayer(payerName: string | null): FilingGuide {
  if (!payerName) return GENERIC_GUIDE;
  for (const g of GUIDES) {
    if (g.match.test(payerName)) return g.guide;
  }
  return { ...GENERIC_GUIDE, payer: payerName };
}
