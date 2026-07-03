// Lokale Typ-Ergänzungen (F-18) — nur Dev/Typecheck, kein Laufzeit-Code.

// pdf-lib: `updateMetadata` ist eine gültige Laufzeit-Option von
// PDFDocument.save(), fehlt aber im SaveOptions-Typ. Gezielte Module-
// Augmentation statt flächigem `any`.
declare module "pdf-lib" {
  interface SaveOptions {
    updateMetadata?: boolean;
  }
}

// File System Access API: der Permission-Descriptor ist in der aktuellen
// TS-DOM-lib nicht deklariert. Lokale Ergänzung.
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: "read" | "readwrite";
  }
}

export {};
