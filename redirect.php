<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
    <meta charset="utf-8">
    <title>Redirecting...</title>
</head>
<body data-color-mode="auto" data-light-theme="light" data-dark-theme="dark_dimmed">
<form method="POST" action="index.php" id="redirect">
    <input type="hidden" name="visualisation" id="visualisation" value=''>
</form>
<script type="text/javascript">
    try {
        var url = new URL(window.location.href);
        var form = document.getElementById("redirect");
        document.getElementById("visualisation").value = decodeURIComponent(url.hash.substring(1)); //remove '#'
        form.submit();
    } catch (error) {
        alert(error);
    }
</script>
</body>
</html>
