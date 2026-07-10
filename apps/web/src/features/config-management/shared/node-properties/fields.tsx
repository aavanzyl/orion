import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Small muted field label used throughout the node property editors. */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <Label className="text-xs text-muted-foreground">{children}</Label>;
}

/** A simple labelled checkbox row. */
export function Checkbox({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="size-4 accent-primary"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {children}
    </label>
  );
}

/** A numeric input that maps empty string to `undefined`. */
export function NumberField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type="number"
        min={0}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? undefined : Number(raw));
        }}
      />
    </div>
  );
}

/** Shape shared by every per-type node property editor. */
export interface NodeTypeEditorProps {
  data: import('../node-model').NodeData;
  onChange: (patch: Partial<import('../node-model').NodeData>) => void;
  /** Available downstream node keys for condition target selects. */
  targetOptions?: string[];
  /** Node ids that can be referenced in expressions (e.g. condition builder). */
  referenceOptions?: string[];
}

/** Read a string value out of the free-form `config` bag. */
export function configString(config: Record<string, unknown> | undefined, key: string): string {
  const value = config?.[key];
  return typeof value === 'string' ? value : '';
}

/** Return a new `config` bag with `key` set (or removed when empty/undefined). */
export function setConfig(
  config: Record<string, unknown> | undefined,
  key: string,
  value: unknown,
): Record<string, unknown> | undefined {
  const next = { ...(config ?? {}) };
  if (value === undefined || value === '' || value === null) {
    delete next[key];
  } else {
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
