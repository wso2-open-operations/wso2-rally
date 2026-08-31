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

import { useContext } from "react";
import SuccessBannerContext, {
  type SuccessBannerContextType,
} from "@context/success-banner/SuccessBannerContext";

/**
 * Accesses the app-wide success banner.
 *
 * Lives apart from the provider so the provider module exports only components,
 * which is what Fast Refresh needs to hot-reload it.
 *
 * @returns {SuccessBannerContextType} The banner API.
 */
export function useSuccessBanner(): SuccessBannerContextType {
  const context = useContext(SuccessBannerContext);
  if (context === undefined) {
    throw new Error(
      "useSuccessBanner must be used within a SuccessBannerProvider",
    );
  }

  return context;
}
