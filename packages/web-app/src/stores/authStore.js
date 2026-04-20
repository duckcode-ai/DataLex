/* authStore — permissive no-op shim.
 *
 * DataLex is open-source and runs locally. There are no user accounts,
 * no sessions, no login page, no role-based access control. This shim
 * exists only so components that were written against the old store
 * (inspectors, panels, toolbars using `canEdit()` / `isAdmin()` / `user`)
 * keep importing without breakage.
 *
 * Every capability returns true; `user` is a constant identity used by
 * UI chrome that likes to show "who am I" labels. A future cleanup can
 * delete this shim and strip the `canEdit` / `isAdmin` call sites.
 */
import { create } from "zustand";

const DEFAULT_USER = Object.freeze({
  id: "local",
  username: "local",
  name: "Local user",
  role: "admin",
});

const useAuthStore = create(() => ({
  user: DEFAULT_USER,
  token: null,
  isAuthenticated: true,
  isLoading: false,

  // Legacy lifecycle hooks — all no-ops.
  restoreSession: async () => {},
  login: async () => {
    throw new Error("DataLex is open-source; login is disabled.");
  },
  logout: async () => {},

  // Permission predicates — always permissive.
  isAdmin: () => true,
  isViewer: () => false,
  canEdit: () => true,
}));

export default useAuthStore;
