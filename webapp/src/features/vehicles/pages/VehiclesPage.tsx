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

import { useEffect, useState, type JSX } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  MenuItem,
  TablePagination,
  TextField,
  Typography,
} from "@wso2/oxygen-ui";
import { Plus, Search } from "@wso2/oxygen-ui-icons-react";
import EventSelect from "@components/event-select/EventSelect";
import FleetToolbar from "@features/vehicles/components/FleetToolbar";
import ImportCsvDialog from "@features/vehicles/components/ImportCsvDialog";
import VehicleEditDialog from "@features/vehicles/components/VehicleEditDialog";
import VehiclesTable from "@features/vehicles/components/VehiclesTable";
import { useSearchVehicles } from "@features/vehicles/api/useSearchVehicles";
import { useExportVehiclesCsv } from "@features/vehicles/api/useExportVehiclesCsv";
import {
  useCreateVehicle,
  useDeleteVehicle,
  useImportVehiclesCsv,
  useUpdateVehicle,
} from "@features/vehicles/api/useVehicleMutations";
import { useListRoutes } from "@features/routes/api/useListRoutes";
import { useEventSelection } from "@hooks/useEventSelection";
import { useErrorBanner } from "@context/error-banner/useErrorBanner";
import { useSuccessBanner } from "@context/success-banner/useSuccessBanner";
import { getApiErrorMessage } from "@utils/ApiError";
import { DEFAULT_PAGE_SIZE } from "@constants/apiConstants";
import type { CreateVehicleRequest, Vehicle, VehicleStatus } from "@/types/vehicle";

/** The blank vehicle the "+ Vehicle" button opens the dialog with. */
const newVehicle = (eventId: string): Vehicle => ({
  id: "",
  eventId,
  code: "",
  teamName: "",
  vehicleType: "",
  contactNumber: "",
  routeId: "",
  status: "ok",
  crew: [],
});

/**
 * A5 — vehicles and crews.
 *
 * These rows are what the in-car app offers a crew at the start line: the
 * vehicle they pick, the name they pick, and the phone number whose last four
 * digits authenticate them. A missing number here is a crew that cannot start.
 *
 * @returns {JSX.Element} The vehicles page.
 */
export default function VehiclesPage(): JSX.Element {
  const { showError } = useErrorBanner();
  const { showSuccess } = useSuccessBanner();

  const {
    events,
    selectedEvent,
    selectedEventId,
    selectEvent,
    isLoading: isEventsLoading,
    error: eventsError,
  } = useEventSelection();

  const [query, setQuery] = useState("");
  const [routeFilter, setRouteFilter] = useState("");
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_PAGE_SIZE);

  const { data: routes } = useListRoutes(selectedEventId);
  const { data, error, isLoading, isFetching } = useSearchVehicles({
    eventId: selectedEventId,
    query,
    routeId: routeFilter,
    offset: page * rowsPerPage,
    limit: rowsPerPage,
  });

  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const deleteVehicle = useDeleteVehicle();
  const importCsv = useImportVehiclesCsv();
  const exportCsv = useExportVehiclesCsv();

  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Vehicle | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);

  const vehicles = data?.items ?? [];
  const totalCount = data?.totalCount ?? 0;
  const loadError = eventsError ?? error;

  useEffect(() => {
    if (loadError) {
      showError(getApiErrorMessage(loadError) ?? "Could not load this event's fleet.");
    }
  }, [loadError, showError]);

  const onMutationError = (fallback: string) => (mutationError: Error) =>
    showError(getApiErrorMessage(mutationError) ?? fallback);

  // Narrowing the fleet from page 5 would otherwise land on an empty page.
  const refilter = (apply: () => void): void => {
    apply();
    setPage(0);
  };

  // A route filter is an id from one event's routes, so it matches nothing in
  // the next one and would silently empty the table. The page number belongs to
  // the old result set for the same reason.
  const changeEvent = (eventId: string): void => {
    setRouteFilter("");
    setPage(0);
    selectEvent(eventId);
  };

  const handleSave = (
    body: CreateVehicleRequest & { status?: VehicleStatus },
  ): void => {
    if (!editing || !selectedEventId) return;

    if (editing.id === "") {
      createVehicle.mutate(
        { eventId: selectedEventId, body },
        {
          onSuccess: (created) => {
            showSuccess(`${created.code} added.`);
            setEditing(null);
          },
          onError: onMutationError("Could not add the vehicle."),
        },
      );

      return;
    }

    updateVehicle.mutate(
      { vehicleId: editing.id, eventId: selectedEventId, body },
      {
        onSuccess: () => {
          showSuccess(`${body.code} saved.`);
          setEditing(null);
        },
        onError: onMutationError("Could not save the vehicle."),
      },
    );
  };

  const handleDelete = (): void => {
    if (!pendingDelete || !selectedEventId) return;

    deleteVehicle.mutate(
      { vehicleId: pendingDelete.id, eventId: selectedEventId },
      {
        onSuccess: () => {
          showSuccess(`${pendingDelete.code} removed.`);
          setPendingDelete(null);
          // Removing the last row of a later page would otherwise leave the
          // table empty while earlier pages still hold rows.
          if (vehicles.length === 1 && page > 0) {
            setPage(page - 1);
          }
        },
        onError: onMutationError("Could not remove the vehicle."),
      },
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2, width: "100%" }}>
      <Box sx={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <Typography variant="h5">
          Vehicles &amp; crews
          {!isLoading && data && (
            <Typography color="text.secondary" component="span" variant="h5">
              {" "}
              · {totalCount}
            </Typography>
          )}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <EventSelect
          events={events}
          isLoading={isEventsLoading}
          onChange={changeEvent}
          selectedEventId={selectedEventId}
        />
        <FleetToolbar
          canExport={totalCount > 0}
          isExporting={exportCsv.isPending}
          isImporting={importCsv.isPending}
          onExport={() =>
            selectedEventId &&
            exportCsv.mutate(
              { eventId: selectedEventId, eventName: selectedEvent?.name },
              { onError: onMutationError("Could not export the fleet.") },
            )
          }
          onImport={() => setIsImportOpen(true)}
        />
        <Button
          disabled={!selectedEventId}
          onClick={() => setEditing(newVehicle(selectedEventId ?? ""))}
          startIcon={<Plus size={16} />}
          type="button"
          variant="contained"
        >
          Vehicle
        </Button>
      </Box>

      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
        <TextField
          InputProps={{ startAdornment: <Search size={16} style={{ marginRight: 8 }} /> }}
          label="Find a vehicle"
          onChange={(changeEvent) => refilter(() => setQuery(changeEvent.target.value))}
          placeholder="Code or team name"
          size="small"
          sx={{ flex: "1 1 260px", maxWidth: 360 }}
          value={query}
        />
        <TextField
          label="Route"
          onChange={(changeEvent) =>
            refilter(() => setRouteFilter(changeEvent.target.value))
          }
          select
          size="small"
          sx={{ flex: "0 1 180px", minWidth: 160 }}
          value={routeFilter}
        >
          <MenuItem value="">All routes</MenuItem>
          {(routes ?? []).map((route) => (
            <MenuItem key={route.id} value={route.id}>
              {route.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      <VehiclesTable
        isLoading={isEventsLoading || isLoading}
        onDelete={setPendingDelete}
        onEdit={setEditing}
        routes={routes ?? []}
        vehicles={vehicles}
      />

      <TablePagination
        component="div"
        count={totalCount}
        disabled={isFetching}
        onPageChange={(_pageEvent, next) => setPage(next)}
        onRowsPerPageChange={(changeEvent) =>
          refilter(() => setRowsPerPage(Number(changeEvent.target.value)))
        }
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 20, 50, 100]}
      />

      <Typography color="text.secondary" variant="caption">
        These records feed the in-car app's start-line dropdowns. A crew member
        joins by picking their own name and typing the last four digits of the
        number recorded here.
      </Typography>

      <VehicleEditDialog
        isSaving={createVehicle.isPending || updateVehicle.isPending}
        onClose={() => setEditing(null)}
        onSave={handleSave}
        routes={routes ?? []}
        vehicle={editing}
      />

      <ImportCsvDialog
        isImporting={importCsv.isPending}
        onClose={() => setIsImportOpen(false)}
        onImport={(file) =>
          selectedEventId &&
          importCsv.mutate(
            { eventId: selectedEventId, file },
            {
              onSuccess: (result) => {
                showSuccess(
                  `${result.imported} ${result.imported === 1 ? "vehicle" : "vehicles"} imported.`,
                );
                setIsImportOpen(false);
              },
              onError: onMutationError("Could not import the file."),
            },
          )
        }
        open={isImportOpen}
      />

      <Dialog onClose={() => setPendingDelete(null)} open={pendingDelete !== null}>
        <DialogContent>
          <DialogContentText variant="body2">
            Remove <strong>{pendingDelete?.code}</strong> and its crew? This is for
            correcting provisioning — a vehicle that has already started the rally
            cannot be removed, because its score and submissions would go with it.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={deleteVehicle.isPending}
            onClick={() => setPendingDelete(null)}
            type="button"
          >
            Cancel
          </Button>
          <Button
            color="error"
            disabled={deleteVehicle.isPending}
            onClick={handleDelete}
            type="button"
            variant="contained"
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
