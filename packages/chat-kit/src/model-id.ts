/** The key model ids are compared by across spellings: lower case, `.` read as `-` (`gpt-5.6-sol` and `gpt-5-6-sol` share one). */
export function modelIdKey(id: string): string {
  return id.toLowerCase().replaceAll(".", "-");
}
