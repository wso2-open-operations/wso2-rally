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
  useRef,
  useState,
  type ReactNode,
  type JSX,
} from "react";

// Holding the bar for a beat after the last caller finishes stops it from
// strobing when two short requests land back to back.
const HIDE_DELAY_MS = 500;

export interface LoaderContextType {
  isVisible: boolean;
  showLoader: () => void;
  hideLoader: () => void;
}

const LoaderContext = createContext<LoaderContextType | undefined>(undefined);

LoaderContext.displayName = "LoaderContext";

/**
 * Provides the top linear progress bar.
 *
 * Reference-counted: concurrent callers each show and hide, and the bar only
 * disappears once the last one is done.
 *
 * @param {{ children: ReactNode }} props - Provider props.
 * @returns {JSX.Element} The provider.
 */
export function LoaderProvider({ children }: { children: ReactNode }): JSX.Element {
  const [isVisible, setIsVisible] = useState(false);
  const loaderCount = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showLoader = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    loaderCount.current += 1;
    setIsVisible(true);
  }, []);

  const hideLoader = useCallback(() => {
    loaderCount.current = Math.max(0, loaderCount.current - 1);
    if (loaderCount.current > 0) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsVisible(false);
      timeoutRef.current = null;
    }, HIDE_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const contextValue = useMemo(
    () => ({ isVisible, showLoader, hideLoader }),
    [isVisible, showLoader, hideLoader],
  );

  return (
    <LoaderContext.Provider value={contextValue}>{children}</LoaderContext.Provider>
  );
}

export default LoaderContext;
