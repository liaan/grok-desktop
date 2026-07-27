import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { redactSensitiveText } from "./privacy";

export type PrivacyContextValue = {
  privacyMode: boolean;
  home: string | null;
  /** Display-only path / text redaction when Privacy mode is on. */
  redact: (text: string | null | undefined) => string;
};

const PrivacyContext = createContext<PrivacyContextValue>({
  privacyMode: false,
  home: null,
  redact: (text) => (text == null ? "" : String(text)),
});

export function PrivacyProvider({
  privacyMode,
  home,
  children,
}: {
  privacyMode: boolean;
  home: string | null;
  children: ReactNode;
}) {
  const value = useMemo<PrivacyContextValue>(
    () => ({
      privacyMode,
      home,
      redact: (text) =>
        redactSensitiveText(
          text == null ? "" : String(text),
          home,
          privacyMode,
        ),
    }),
    [privacyMode, home],
  );

  return (
    <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
