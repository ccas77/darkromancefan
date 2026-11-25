export function env(name: string): string {
  const v = (import.meta.env?.[name] ?? process.env[name]) as string | undefined;
  return v ?? '';
}
