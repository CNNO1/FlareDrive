import { ThemeProvider } from "@emotion/react";
import {
  Alert,
  Box,
  Button,
  createTheme,
  CssBaseline,
  GlobalStyles,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useState } from "react";

import Header from "./Header";
import Main from "./Main";
import ProgressDialog from "./ProgressDialog";
import {
  clearWebDavCredentials,
  hasWebDavAuth,
  setWebDavCredentials,
} from "./app/auth";
import { TransferQueueProvider } from "./app/transferQueue";

const globalStyles = (
  <GlobalStyles styles={{ "html, body, #root": { height: "100%" } }} />
);

const theme = createTheme({
  palette: { primary: { main: "#f38020" } },
});

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        setWebDavCredentials(username, password);
        onLogin();
      }}
      sx={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 360,
          border: "1px solid",
          borderColor: "divider",
          padding: 3,
        }}
      >
        <Stack spacing={2}>
          <Typography variant="h6">FlareDrive</Typography>
          <TextField
            autoFocus
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button
            type="submit"
            variant="contained"
            disabled={!username || !password}
          >
            Sign in
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

function App() {
  const [search, setSearch] = useState("");
  const [showProgressDialog, setShowProgressDialog] = React.useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(hasWebDavAuth());

  const handleError = (newError: Error) => {
    if (newError.message === "Unauthorized") {
      clearWebDavCredentials();
      setIsAuthenticated(false);
      setError(new Error("Invalid username or password"));
      return;
    }
    setError(newError);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {globalStyles}
      <TransferQueueProvider>
        {isAuthenticated ? (
          <Stack sx={{ height: "100%" }}>
            <Header
              search={search}
              onSearchChange={(newSearch: string) => setSearch(newSearch)}
              setShowProgressDialog={setShowProgressDialog}
            />
            <Alert severity="info" sx={{ borderRadius: 0 }}>
              当前网盘仅用于轻量资料，建议本项目容量上限：3GB。
            </Alert>
            <Main search={search} onError={handleError} />
          </Stack>
        ) : (
          <Login onLogin={() => setIsAuthenticated(true)} />
        )}
        <Snackbar
          autoHideDuration={5000}
          open={Boolean(error)}
          message={error?.message}
          onClose={() => setError(null)}
        />
        <ProgressDialog
          open={showProgressDialog}
          onClose={() => setShowProgressDialog(false)}
        />
      </TransferQueueProvider>
    </ThemeProvider>
  );
}

export default App;
