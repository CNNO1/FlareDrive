import { ThemeProvider } from "@emotion/react";
import {
  Box,
  Button,
  Chip,
  createTheme,
  CssBaseline,
  GlobalStyles,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { LockOutlined as LockIcon } from "@mui/icons-material";
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
  <GlobalStyles
    styles={{
      "html, body, #root": { height: "100%" },
      body: { backgroundColor: "#f6f7f9" },
      "*": { boxSizing: "border-box" },
    }}
  />
);

const theme = createTheme({
  palette: {
    primary: { main: "#2563eb" },
    secondary: { main: "#f97316" },
    background: { default: "#f6f7f9" },
  },
  shape: { borderRadius: 8 },
});

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        setWebDavCredentials(username.trim(), password);
        onLogin();
      }}
      sx={{
        minHeight: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 2,
        backgroundColor: "background.default",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 388,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          padding: { xs: 2.5, sm: 3 },
        }}
      >
        <Stack spacing={2.25}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 1,
                display: "grid",
                placeItems: "center",
                color: "common.white",
                backgroundColor: "primary.main",
              }}
            >
              <LockIcon />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                FlareDrive Light
              </Typography>
              <Typography variant="body2" color="text.secondary">
                私人资料盘
              </Typography>
            </Box>
          </Stack>
          <Chip
            label="仅限授权访问"
            color="primary"
            variant="outlined"
            size="small"
            sx={{ alignSelf: "flex-start" }}
          />
          <TextField
            autoFocus
            label="用户名"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <TextField
            label="密码"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={!username || !password}
            sx={{ height: 44 }}
          >
            登录
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
      setError(new Error("用户名或密码错误"));
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
              onLogout={() => {
                clearWebDavCredentials();
                setSearch("");
                setIsAuthenticated(false);
              }}
            />
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
