export type DemoIntakeTurn = {
  readonly role: "agent" | "customer";
  readonly text: string;
  readonly delayMs: number;
  readonly fieldUpdate?: {
    readonly path: "vehicle.mileage" | "completionByDays";
    readonly value: number;
  };
};

export const DEMO_INTAKE_TURNS: readonly DemoIntakeTurn[] = [
  {
    role: "agent",
    text: "Hi — I'm confirming the details for your Camry brake job. Quick questions, then we'll call shops.",
    delayMs: 1_200,
  },
  {
    role: "agent",
    text: "The estimate reads 52,000 miles. Is your current mileage close to that, or higher?",
    delayMs: 3_400,
  },
  {
    role: "customer",
    text: "It's closer to 62,000 now.",
    delayMs: 2_200,
    fieldUpdate: { path: "vehicle.mileage", value: 62_000 },
  },
  {
    role: "agent",
    text: "Got it — noting 62,000. Are you okay with premium aftermarket pads and rotors?",
    delayMs: 2_800,
  },
  {
    role: "customer",
    text: "Yes, premium aftermarket is fine.",
    delayMs: 1_800,
  },
  {
    role: "agent",
    text: "When do you need this done by?",
    delayMs: 1_400,
  },
  {
    role: "customer",
    text: "Within a week.",
    delayMs: 1_400,
    fieldUpdate: { path: "completionByDays", value: 7 },
  },
  {
    role: "agent",
    text: "Perfect. I have everything I need. Review the spec on the next screen.",
    delayMs: 2_000,
  },
];
