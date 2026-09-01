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
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

package vehicles

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/wso2-open-operations/wso2-motor-rally/backend/internal/httpx"
)

// maxImportBytes caps a CSV upload. The rally runs ~150 vehicles, so a file
// larger than this is a mistake rather than a bigger event.
const maxImportBytes = 2 << 20 // 2 MiB

// csvFormField is the multipart field name the web app uploads under.
const csvFormField = "file"

// Handler exposes the vehicles and crew REST surface.
type Handler struct {
	service *Service
	logger  *slog.Logger
}

// NewHandler wires a Handler to its service.
func NewHandler(service *Service, logger *slog.Logger) *Handler {
	return &Handler{service: service, logger: logger}
}

// Register adds the vehicle endpoints to r.
func (h *Handler) Register(r chi.Router) {
	r.Post("/events/{eventId}/vehicles", h.create)
	r.Post("/events/{eventId}/vehicles/search", h.search)
	r.Post("/events/{eventId}/vehicles/import", h.importCSV)
	r.Get("/events/{eventId}/vehicles/export", h.exportCSV)
	r.Get("/vehicles/{vehicleId}", h.get)
	r.Patch("/vehicles/{vehicleId}", h.update)
	r.Delete("/vehicles/{vehicleId}", h.delete)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var req CreateVehicleRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	vehicle, err := h.service.Create(r.Context(), req.toCreateInput(chi.URLParam(r, "eventId")))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteCreated(w, "/vehicles/"+vehicle.ID, toDTO(vehicle))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	vehicle, err := h.service.Get(r.Context(), chi.URLParam(r, "vehicleId"))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toDTO(vehicle))
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	var req UpdateVehicleRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	vehicle, err := h.service.Update(r.Context(), chi.URLParam(r, "vehicleId"), req.toUpdateInput())
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, toDTO(vehicle))
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) {
	var req SearchVehiclesRequest
	if err := httpx.DecodeJSON(r, &req); err != nil {
		httpx.WriteBadRequest(w, err)
		return
	}

	found, total, err := h.service.Search(r.Context(), chi.URLParam(r, "eventId"),
		req.toFilter(), httpx.NormalizePage(req.Offset, req.Limit))
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, httpx.NewSearchResult(toDTOs(found), total))
}

// delete removes a vehicle that should not have been provisioned. It is refused
// with a 409 once the vehicle has run, so a correction can never erase a result.
func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	if err := h.service.Delete(r.Context(), chi.URLParam(r, "vehicleId")); err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteNoContent(w)
}

// importCSV provisions vehicles from an uploaded spreadsheet.
func (h *Handler) importCSV(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxImportBytes)

	file, _, err := r.FormFile(csvFormField)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest,
			"Attach the vehicle CSV as a multipart file field named \"file\".")
		return
	}
	defer func() { _ = file.Close() }()

	imported, err := h.service.ImportCSV(r.Context(), chi.URLParam(r, "eventId"), file)
	if err != nil {
		httpx.WriteDomainError(w, r, h.logger, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, ImportResultDTO{Imported: imported})
}

// exportCSV streams the event's vehicles as a downloadable file.
func (h *Handler) exportCSV(w http.ResponseWriter, r *http.Request) {
	eventID := chi.URLParam(r, "eventId")

	// Headers must be set before the first write, and the body streams
	// straight out, so an error mid-file can only be logged.
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="vehicles.csv"`)

	if err := h.service.ExportCSV(r.Context(), eventID, w); err != nil {
		h.logger.Error("vehicle csv export failed",
			"error", err,
			"event_id", eventID,
			"request_id", httpx.RequestIDFrom(r.Context()),
		)
	}
}
