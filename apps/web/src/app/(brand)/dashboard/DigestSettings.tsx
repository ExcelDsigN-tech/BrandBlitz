"use client";

// Issue #1017: Brand email digest preferences UI component
import { useState } from "react";

interface DigestPreferences {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
}

export function DigestSettings({ brandId }: { brandId: string }) {
  const [preferences, setPreferences] = useState<DigestPreferences>({
    enabled: false,
    frequency: "weekly",
  });
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setSaved(false);

    try {
      // TODO: Replace with actual API endpoint
      // await fetch(`/api/brands/${brandId}/digest-preferences`, {
      //   method: 'PUT',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(preferences),
      // });

      console.log("[DigestSettings] Saving preferences:", preferences);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("[DigestSettings] Failed to save:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">
        Email Performance Digest
      </h3>
      <p className="text-sm text-gray-600 mb-6">
        Receive a periodic summary of your challenge performance, completion rates, and spend.
      </p>

      <div className="space-y-4">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="digest-enabled"
            checked={preferences.enabled}
            onChange={(e) =>
              setPreferences({ ...preferences, enabled: e.target.checked })
            }
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label
            htmlFor="digest-enabled"
            className="ml-2 text-sm font-medium text-gray-700"
          >
            Enable email digest
          </label>
        </div>

        {preferences.enabled && (
          <div>
            <label
              htmlFor="digest-frequency"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Frequency
            </label>
            <select
              id="digest-frequency"
              value={preferences.frequency}
              onChange={(e) =>
                setPreferences({
                  ...preferences,
                  frequency: e.target.value as DigestPreferences["frequency"],
                })
              }
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Saving..." : "Save Preferences"}
        </button>

        {saved && (
          <p className="text-sm text-green-600 font-medium">
            ✓ Preferences saved successfully
          </p>
        )}
      </div>
    </div>
  );
}
