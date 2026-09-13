/** Roamgate names take precedence, including an explicitly empty value. */
export function roamgateEnv(
  suffix: string,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  return (
    environment[`ROAMGATE_${suffix}`] ?? environment[`HERDR_GUI_${suffix}`]
  );
}
