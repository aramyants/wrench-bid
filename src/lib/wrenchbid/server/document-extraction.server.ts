import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvidenceMeta, RepairOperation, RepairSpec } from "../types";
import { AUTO_REPAIR_VERTICAL } from "../verticals/auto-repair";
import { getServerEnvironment } from "./env.server";

const VEHICLE_MAKES = [
  "Acura",
  "Audi",
  "BMW",
  "Buick",
  "Cadillac",
  "Chevrolet",
  "Chrysler",
  "Dodge",
  "Ford",
  "Genesis",
  "GMC",
  "Honda",
  "Hyundai",
  "Infiniti",
  "Jeep",
  "Kia",
  "Lexus",
  "Lincoln",
  "Mazda",
  "Mercedes-Benz",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Ram",
  "Subaru",
  "Tesla",
  "Toyota",
  "Volkswagen",
  "Volvo",
];

export type StoredDocument = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  extractedText: string;
};

function normalizeText(value: string) {
  return value
    .replaceAll("\u0000", "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(data: Uint8Array) {
  const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  (globalThis as typeof globalThis & { pdfjsWorker?: typeof worker }).pdfjsWorker ??= worker;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  try {
    for (let index = 1; index <= Math.min(document.numPages, 50); index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(
        content.items
          .filter((item): item is typeof item & { str: string } => "str" in item)
          .map((item) => item.str)
          .join(" "),
      );
      page.cleanup();
    }
  } finally {
    await document.cleanup();
    await loadingTask.destroy();
  }
  return normalizeText(pages.join("\n"));
}

function sourceMeta(
  status: EvidenceMeta["status"],
  confidence: number,
  excerpt?: string,
): EvidenceMeta {
  return { source: "document", status, confidence, excerpt };
}

function firstMatch(text: string, expression: RegExp) {
  const match = expression.exec(text);
  return match?.[1]?.trim();
}

function findVehicle(text: string) {
  const makePattern = VEHICLE_MAKES.map((make) => make.replace("-", "[- ]")).join("|");
  const expression = new RegExp(
    `\\b((?:19|20)\\d{2})\\s+(${makePattern})\\s+([A-Za-z0-9-]+)(?:\\s+([A-Za-z0-9.-]+))?`,
    "i",
  );
  const match = expression.exec(text);
  return {
    year: match ? Number(match[1]) : 0,
    make: match?.[2] ?? "",
    model: match?.[3] ?? "",
    trim: match?.[4],
    excerpt: match?.[0],
  };
}

function findOperations(text: string): RepairOperation[] {
  const candidates = text
    .split(/\n|(?<=[.;])\s+/)
    .map((line) => line.trim())
    .filter((line) =>
      /\b(replace|repair|remove|install|service|r&r|pads?|rotors?|brakes?|tires?|battery|alternator|starter|oil|filter)\b/i.test(
        line,
      ),
    )
    .filter((line) => line.length >= 8 && line.length <= 220)
    .slice(0, 8);

  const unique = [...new Set(candidates)];
  return unique.map((description) => ({
    id: randomUUID(),
    description,
    partsPreference: /\bOEM\b/i.test(description) ? "oem" : "any",
    customerSuppliedParts: false,
  }));
}

export function buildRepairSpecFromText(
  sessionId: string,
  text: string,
  documentName: string,
): RepairSpec {
  const vehicle = findVehicle(text);
  const mileageText = firstMatch(
    text,
    /\b(?:odometer|mileage|miles?|mi)\s*[:#-]?\s*([0-9][0-9,]{2,8})\b/i,
  );
  const mileage = mileageText ? Number(mileageText.replace(/,/g, "")) : 0;
  const vin = firstMatch(text, /\b(?:VIN\s*[:#-]?\s*)?([A-HJ-NPR-Z0-9]{17})\b/i) ?? "";
  const location = /\b([A-Za-z .'-]+),?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/.exec(text);
  const operations = findOperations(text);
  const now = new Date().toISOString();

  return {
    id: randomUUID(),
    sessionId,
    version: 1,
    status: "draft",
    vehicle: {
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      trim: vehicle.trim,
      mileage,
      vinLast8: vin.slice(-8),
    },
    diagnosisSource: `Uploaded estimate: ${documentName}`,
    operations,
    location: {
      city: location?.[1]?.trim() ?? "",
      region: location?.[2] ?? "",
      postal: location?.[3] ?? "",
    },
    completionByDays: 7,
    requiredQuoteFields: [...AUTO_REPAIR_VERTICAL.requiredQuoteFields],
    fieldMeta: {
      "vehicle.year": sourceMeta(
        vehicle.year ? "verified" : "missing",
        vehicle.year ? 0.92 : 0,
        vehicle.excerpt,
      ),
      "vehicle.make": sourceMeta(
        vehicle.make ? "verified" : "missing",
        vehicle.make ? 0.92 : 0,
        vehicle.excerpt,
      ),
      "vehicle.model": sourceMeta(
        vehicle.model ? "verified" : "missing",
        vehicle.model ? 0.88 : 0,
        vehicle.excerpt,
      ),
      "vehicle.trim": sourceMeta(
        vehicle.trim ? "needs_confirmation" : "missing",
        vehicle.trim ? 0.65 : 0,
        vehicle.excerpt,
      ),
      "vehicle.mileage": sourceMeta(
        mileage ? "needs_confirmation" : "missing",
        mileage ? 0.72 : 0,
        mileageText,
      ),
      "vehicle.vinLast8": sourceMeta(
        vin ? "needs_confirmation" : "missing",
        vin ? 0.8 : 0,
        vin || undefined,
      ),
      operations: sourceMeta(
        operations.length ? "needs_confirmation" : "missing",
        operations.length ? 0.7 : 0,
        operations[0]?.description,
      ),
      location: sourceMeta(
        location ? "needs_confirmation" : "missing",
        location ? 0.75 : 0,
        location?.[0],
      ),
      completionByDays: sourceMeta("missing", 0),
    },
    createdAt: now,
  };
}

export async function validateExtractAndStoreDocument(file: File): Promise<StoredDocument> {
  if (file.type !== "application/pdf") {
    throw new Response("Only PDF estimates are supported for live extraction", { status: 415 });
  }
  if (file.size <= 0 || file.size > AUTO_REPAIR_VERTICAL.maxDocumentBytes) {
    throw new Response("The PDF must be between 1 byte and 10 MB", { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = new TextDecoder("ascii").decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") {
    throw new Response("The uploaded file is not a valid PDF", { status: 415 });
  }

  // PDF.js transfers/detaches its input buffer; keep the original bytes for hashing and storage.
  const extractedText = await extractPdfText(bytes.slice());
  if (extractedText.length < 20) {
    throw new Response(
      "No selectable text was found in this PDF. Upload a text-based estimate or enter the details manually.",
      { status: 422 },
    );
  }

  const id = randomUUID();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${id}.pdf`;
  const uploadDirectory = path.resolve(getServerEnvironment().UPLOAD_DIR);
  await mkdir(uploadDirectory, { recursive: true, mode: 0o700 });
  const storagePath = path.join(uploadDirectory, storageKey);
  try {
    await writeFile(storagePath, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    await rm(storagePath, { force: true });
    throw error;
  }

  return {
    id,
    originalName: path.basename(file.name).slice(0, 180) || "estimate.pdf",
    mimeType: "application/pdf",
    sizeBytes: file.size,
    sha256,
    storageKey,
    extractedText,
  };
}

export async function deleteStoredDocument(storageKey: string) {
  if (!/^[0-9a-f-]{36}\.pdf$/i.test(storageKey)) return;
  const uploadDirectory = path.resolve(getServerEnvironment().UPLOAD_DIR);
  const target = path.resolve(uploadDirectory, storageKey);
  if (path.dirname(target) !== uploadDirectory) return;
  await rm(target, { force: true });
}
