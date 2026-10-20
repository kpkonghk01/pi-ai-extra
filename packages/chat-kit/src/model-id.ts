/** A model id compared across spellings: lower case, `.` read as `-` (`gpt-5.6-sol` is `gpt-5-6-sol`). */
export function sameModelId(id: string): string {
  return id.toLowerCase().replaceAll(".", "-");
}
