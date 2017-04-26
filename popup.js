var SslCheckerForm = {};

SslCheckerForm.url = "www.emag.ro"
SslCheckerForm.port = 443;

$.ajax({
    type: "POST",
    url: "https://www.sslchecker.com/sslchecker",
    data: SslCheckerForm,
    success: function(data){
        console.log(data);
    },
    dataType: "html"
});