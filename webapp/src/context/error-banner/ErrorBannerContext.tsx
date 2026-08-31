// Copyright (c) 2026 WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type JSX,
} from "react";
import { BANNER_TIMEOUT_MS } from "@constants/common";
import Banner from "@components/banner/Banner";

export interface ErrorBannerContextType {
  /** Shows the error banner with a user-facing message. */
  showError: (message: string) => void;
}

const ErrorBannerContext = createContext<ErrorBannerContextType | undefined>(
  undefined,
);

ErrorBannerContext.displayName = "ErrorBannerContext";

/**
 * Provides the app-wide error banner.
 *
 * @param {{ children: ReactNode }} props - Provider props.
 * @returns {JSX.Element} The provider with its banner.
 */
export function ErrorBannerProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [message, setMessage] = useState<string | null>(null);
  // Bumped on every showError so a repeated identical message restarts the
  // auto-dismiss timer instead of inheriting the previous one.
  const [key, setKey] = useState(0);

  const showError = useCallback((msg: string) => {
    setMessage(msg);
    setKey((prev) => prev + 1);
  }, []);

  const dismiss = useCallback(() => setMessage(null), []);

  useEffect(() => {
    if (!message) return;

    const timeoutId = setTimeout(dismiss, BANNER_TIMEOUT_MS);

    return () => clearTimeout(timeoutId);
  }, [message, key, dismiss]);

  const contextValue = useMemo(() => ({ showError }), [showError]);

  return (
    <ErrorBannerContext.Provider value={contextValue}>
      {children}
      {message && <Banner severity="error" message={message} onClose={dismiss} />}
    </ErrorBannerContext.Provider>
  );
}

export default ErrorBannerContext;
