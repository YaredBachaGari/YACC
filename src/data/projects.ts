// The project switcher (plan step 7.2): the repos you've run HQ in on this computer.

export interface ProjectEntry {
  slug: string;
  name: string;
  root: string;
  port: number;
  /** Its HQ is answering now. */
  running: boolean;
  /** The project this HQ serves. */
  current: boolean;
  /** Its folder is gone. */
  missing: boolean;
  lastOpened: string;
}
