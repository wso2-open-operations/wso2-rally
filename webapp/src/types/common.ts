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

/** The window every `POST /<resource>/search` accepts. Limit is capped at 100 server-side. */
export interface SearchPage {
  offset: number;
  limit: number;
}

/** The envelope every search endpoint returns. */
export interface SearchResult<T> {
  items: T[];
  totalCount: number;
}

/** The signed-in organizer, as `GET /users/me` reports them. */
export interface CurrentUser {
  userId: string;
  email: string;
  groups: string[];
}
